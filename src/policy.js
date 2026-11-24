import path from "node:path";
import { expandHome } from "./util.js";
import { testScratchViolation } from "./scratch-guard.js";
import { recognizeDestructive } from "./destructive.js";

export const DEFAULT_POLICY = {
  denyPaths: [
    "**/.env",
    "**/.env.*",
    "**/*.pem",
    "**/*.key",
    "**/*.p12",
    "**/*.pfx",
    "**/secrets/**",
    "~/.ssh/**",
    "~/.aws/**",
    "~/.gnupg/**",
    "~/.config/gh/hosts.yml",
    "~/Library/Keychains/**",
  ],
  // Destructive git and rm forms live in `guards`: they can be confirmed
  // instead of hard-blocked, and their keys are stable identifiers.
  denyCommands: [
    "\\brm\\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\\s+(/|~|\\$HOME|\\.{1,2})(\\s|$)",
    "\\bsudo\\b",
    "\\b(chmod|chown)\\s+-R\\s+777",
    "\\bmkfs\\b",
    "\\bdd\\s+if=.*of=/dev/",
    "\\bcurl[^|]*\\|\\s*(ba)?sh",
    "\\bwget[^|]*\\|\\s*(ba)?sh",
    "\\bnpm\\s+publish\\b",
  ],
  // Destructive operations ask first; hard denies never get that far.
  // Keys are stable identifiers (src/destructive.js GUARD_KEYS), not regexes.
  guards: {
    rmRecursive: "confirm",
    findDelete: "confirm",
    gitResetHard: "confirm",
    gitCleanForce: "confirm",
    gitCheckoutOverwrite: "confirm",
    gitBranchDelete: "confirm",
    gitRebase: "confirm",
    gitStashDrop: "confirm",
    destructiveSql: "confirm",
    gitPushForce: "block",
    diskWrite: "block",
  },
  requireTaskForWrite: false,
  maxChangedLines: 400,
  allowNetwork: true,
  allowPush: false,
};

/**
 * Minimal glob -> RegExp. Supports **, *, ? and ~ expansion.
 * Not a full glob implementation, but predictable for policy paths.
 */
export function globToRegExp(pattern) {
  let p = pattern.replace(/\\/g, "/");
  if (p.startsWith("~/")) p = `${expandHome("~")}${p.slice(1)}`;
  const absolute = p.startsWith("/");
  let body = p.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  body = body
    .replace(/\*\*\//g, "\u0000")
    .replace(/\*\*/g, "\u0001")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\u0000/g, "(?:.*/)?")
    .replace(/\u0001/g, ".*");
  const prefix = absolute ? "^" : "(?:^|.*/)";
  return new RegExp(`${prefix}${body}$`);
}
function normalize(file, cwd) {
  return path.resolve(cwd, expandHome(String(file)));
}

export function matchesPath(file, pattern, cwd) {
  const abs = normalize(file, cwd);
  const rel = path.relative(cwd, abs).replace(/\\/g, "/");
  const re = globToRegExp(pattern);
  return re.test(abs.replace(/\\/g, "/")) || re.test(rel);
}

export function deniedPath(file, policy, cwd) {
  for (const pattern of policy.denyPaths ?? []) {
    if (matchesPath(file, pattern, cwd)) return pattern;
  }
  return null;
}

const WORD_RE = /(?:"(?:\\.|[^"\\])*"|'[^']*'|[^\s;&|()'"<>]+)/g;

function commandWords(command) {
  return [...String(command ?? "").matchAll(WORD_RE)].map((match) => match[0].replace(/^["']|["']$/g, ""));
}

/** A word is a path candidate when it can only be a path, not prose or an option name. */
function looksLikePath(word) {
  if (!word || word.length > 4096) return false;
  if (/^[A-Za-z0-9_.-]+\.(?:env|pem|key|p12|pfx)$/i.test(word)) return true;
  return word.startsWith("/") || word.startsWith("~") || word.startsWith(".") || word.includes("/");
}

function pathCandidates(word) {
  const candidates = [word];
  if (word.startsWith("@")) candidates.push(word.slice(1));
  const equals = word.indexOf("=");
  if (word.startsWith("-") && equals > 0) {
    const value = word.slice(equals + 1);
    candidates.push(value.startsWith("@") ? value.slice(1) : value);
  }
  return candidates;
}

/**
 * First sensitive path mentioned by a shell command (`cat ~/.ssh/id_rsa`,
 * `curl -d @.env`). The tool-level guard only sees `path` inputs, so a command
 * that reads a secret directly would otherwise pass.
 */
export function sensitivePathInCommand(command, policy, cwd = process.cwd()) {
  for (const word of commandWords(command)) {
    for (const candidate of pathCandidates(word)) {
      if (!looksLikePath(candidate)) continue;
      const pattern = deniedPath(candidate, policy, cwd);
      if (pattern) return { path: candidate, pattern };
    }
  }
  return null;
}

/**
 * Map recognized destructive commands to the policy guards.
 * Returns undefined (nothing to say), a block, or a confirmation request.
 */
export function evaluateDestructiveCommand(command, policy = DEFAULT_POLICY) {
  const matches = recognizeDestructive(command);
  if (!matches.length) return undefined;
  const hard = matches.find((match) => match.hardDeny);
  if (hard) {
    const targets = hard.targets?.length ? ` (${hard.targets.join(" ")})` : "";
    return {
      block: true,
      reason: `po-shell policy: ${hard.key} on a protected target is never allowed${targets}`,
    };
  }
  let pending;
  for (const match of matches) {
    const action = policy.guards?.[match.key] ?? DEFAULT_POLICY.guards[match.key] ?? "confirm";
    if (action === "allow") continue;
    if (action === "block") {
      return { block: true, reason: `po-shell policy: command denied by guard ${match.key}` };
    }
    pending ??= match;
  }
  if (!pending) return undefined;
  const targets = pending.targets?.length ? ` (${pending.targets.join(" ")})` : "";
  return {
    block: false,
    confirm: true,
    key: pending.key,
    targets: pending.targets ?? [],
    reason: `po-shell policy: ${pending.key} needs confirmation${targets}`,
  };
}

export function deniedCommand(command, policy) {
  for (const pattern of policy.denyCommands ?? []) {
    try {
      if (new RegExp(pattern, "i").test(command)) return pattern;
    } catch {
      if (command.toLowerCase().includes(pattern.toLowerCase())) return pattern;
    }
  }
  return null;
}

/**
 * Evaluate a model tool call against the deterministic policy.
 * Returns { block, reason, warning }.
 */
export function evaluateToolCall({ toolName, input = {}, cwd, policy, activeTask }) {
  if (toolName.startsWith("po_shell_")) return { block: false };

  const file = input.path ?? input.file_path ?? input.file ?? null;
  const writes = toolName === "write" || toolName === "edit";

  if (file) {
    const pattern = deniedPath(file, policy, cwd);
    if (pattern) {
      return { block: true, reason: `po-shell policy: path denied by ${pattern} (${file})` };
    }
  }

  const scratchViolation = testScratchViolation({ toolName, input, cwd });
  if (scratchViolation) {
    return { block: true, reason: `po-shell policy: ${scratchViolation}` };
  }

  if (writes && policy.requireTaskForWrite && !activeTask) {
    return {
      block: true,
      reason: "po-shell policy: no active task. Create one with po_shell_task before editing.",
    };
  }

  if (toolName === "bash" || toolName === "powershell") {
    const command = String(input.command ?? "");
    if (/\bgit\s+push\b/i.test(command) && policy.allowPush !== true) {
      return {
        block: true,
        reason: "po-shell policy: git push requires allowPush=true; the human owns delivery.",
      };
    }
    const pattern = deniedCommand(command, policy);
    if (pattern) {
      return { block: true, reason: `po-shell policy: command denied by /${pattern}/` };
    }
    const sensitive = sensitivePathInCommand(command, policy, cwd);
    if (sensitive) {
      return {
        block: true,
        reason: `po-shell policy: sensitive path ${sensitive.path} denied by ${sensitive.pattern}`,
      };
    }
    const destructive = evaluateDestructiveCommand(command, policy);
    if (destructive) return destructive;
  }

  return { block: false };
}

export function mutatingCommand(command) {
  const value = String(command ?? "");
  if (/(?:^|[;&|]\s*)(?:>|>>|tee|rm|mv|cp|touch|mkdir|rmdir)\b/.test(value)) return true;
  if (/\bsed\s+-i\b|\bperl\s+-pi\b/.test(value)) return true;
  if (/\bgit\s+(?:apply|checkout|reset|clean|commit|merge|rebase|stash)\b/.test(value)) return true;
  if (/\b(?:npm|pnpm|yarn|bun)\s+(?:install|add|remove|uninstall|update)\b/.test(value)) return true;
  if (/(?:>>?|tee)\s+\S/.test(value)) return true;
  return false;
}
