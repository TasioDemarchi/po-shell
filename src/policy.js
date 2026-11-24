import path from "node:path";
import { expandHome } from "./util.js";
import { testScratchViolation } from "./scratch-guard.js";

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
  denyCommands: [
    "\\brm\\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\\s+(/|~|\\$HOME|\\.{1,2})(\\s|$)",
    "\\bsudo\\b",
    "\\bgit\\s+push\\s+.*--force",
    "\\bgit\\s+reset\\s+--hard",
    "\\bgit\\s+clean\\s+-[a-z]*f",
    "\\b(chmod|chown)\\s+-R\\s+777",
    "\\bmkfs\\b",
    "\\bdd\\s+if=.*of=/dev/",
    "\\bcurl[^|]*\\|\\s*(ba)?sh",
    "\\bwget[^|]*\\|\\s*(ba)?sh",
    "\\bnpm\\s+publish\\b",
  ],
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
