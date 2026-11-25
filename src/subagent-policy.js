import path from "node:path";
import { recognizeDestructive } from "./destructive.js";
import { testScratchViolation } from "./scratch-guard.js";
import { READ_TOOLS, WEB_TOOLS, WRITE_TOOLS, roleRules, withinPrefixes } from "./subagent-roles.js";

const isMarkdown = (value) => /\.md$/i.test(String(value ?? "").replace(/\\/g, "/"));
const isPoShellState = (value) => {
  const p = String(value ?? "").replace(/\\/g, "/");
  return p === ".po-shell" || p.startsWith(".po-shell/") || p.includes("/.po-shell/");
};

function relativeTo(file, cwd) {
  const value = String(file ?? "").replace(/\\/g, "/");
  const base = String(cwd ?? "").replace(/\\/g, "/").replace(/\/$/, "");
  const absolute = value.startsWith("/") ? value : `${base}/${value}`;
  const parts = [];
  for (const segment of absolute.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  const normalized = `/${parts.join("/")}`;
  return normalized.startsWith(`${base}/`) ? normalized.slice(base.length + 1) : normalized.slice(1);
}

function surfaceRegExp(surface) {
  const clean = String(surface).replace(/^\.\//, "").replace(/\\/g, "/");
  const body = clean
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, "\u0000")
    .replace(/\*\*/g, "\u0001")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000/g, "(?:.*/)?")
    .replace(/\u0001/g, ".*");
  return new RegExp(`^${body}$`);
}

/** True when `file` is inside one of the declared surfaces (prefix or simple glob). */
export function withinSurfaces(file, surfaces, cwd = process.cwd()) {
  if (!Array.isArray(surfaces) || surfaces.length === 0) return true;
  const rel = relativeTo(file, cwd);
  for (const surface of surfaces) {
    const clean = String(surface).replace(/^\.\//, "").replace(/\\/g, "/");
    if (!clean) continue;
    if (clean.includes("*")) {
      if (surfaceRegExp(clean).test(rel)) return true;
      continue;
    }
    const prefix = clean.replace(/\/$/, "");
    if (rel === prefix || rel.startsWith(`${prefix}/`)) return true;
  }
  return false;
}

/** Paths a shell command would write, as far as a lexical read can tell. */
export function shellWriteTargets(command) {
  const value = String(command ?? "");
  const targets = [];
  const push = (raw) => {
    const clean = String(raw ?? "").trim().replace(/^["']|["']$/g, "");
    if (clean && !clean.startsWith("-") && !clean.includes("$") && clean !== "/dev/null") targets.push(clean);
  };
  for (const match of value.matchAll(/(?:^|[^0-9])>>?\s*([^\s;&|]+)/g)) push(match[1]);
  for (const match of value.matchAll(/\btee\s+(?:-a\s+)?([^\s;&|]+)/g)) push(match[1]);
  for (const match of value.matchAll(/\bsed\s+-i[^\s]*\s+(?:-e\s+)?\S*\s*([^\s;&|]+)?/g)) push(match[1]);
  for (const match of value.matchAll(/\b(?:cp|mv|install|ln)\s+(?:-[a-zA-Z]+\s+)*[^\s;&|]+\s+([^\s;&|]+)/g)) push(match[1]);
  return [...new Set(targets)];
}

/** Absolute path of a tool argument, resolved against the child's cwd. */
function absoluteTarget(target, cwd) {
  return path.resolve(String(cwd ?? process.cwd()), String(target ?? ""));
}

function insideDir(target, dir) {
  const base = String(dir ?? "").split("\\").join("/").replace(/\/$/, "");
  if (!base) return false;
  const value = String(target ?? "").split("\\").join("/");
  return value === base || value.startsWith(`${base}/`);
}

/**
 * The role matrix, enforced on the child.
 *
 * The parent validates the tool list before launching, and this refuses again at
 * `tool_call`: a child handed a wider list than its role allows — by a bug, by an
 * older parent — still cannot use it. Defense in depth, not decoration.
 */
function roleBlock(toolName, input, cwd, options) {
  const role = String(options.role ?? "").trim().toLowerCase();
  if (!role) return null;
  let rules;
  try {
    rules = roleRules(role);
  } catch (error) {
    return `Subagente: ${(error instanceof Error ? error.message : String(error))}`;
  }

  if (WEB_TOOLS.includes(toolName) && !rules.web) {
    return `${role} no tiene acceso a la web; devolvé la pregunta al padre.`;
  }
  if (WRITE_TOOLS.includes(toolName) && !rules.write) {
    return `${role} no escribe archivos: solo un worker edita, y solo dentro de sus superficies.`;
  }
  if (toolName === "bash" && !rules.bash) {
    return `${role} no ejecuta comandos; pedí al padre que corra la verificación.`;
  }

  if (READ_TOOLS.includes(toolName)) {
    const target = input.path ?? input.file_path ?? input.file;
    if (target == null || target === "") return null;
    const absolute = absoluteTarget(target, cwd);
    const granted = withinPrefixes(absolute, options.readOutside);
    if (insideDir(absolute, cwd) || insideDir(absolute, options.scratch) || granted) return null;
    return `Un subagente lee dentro del proyecto${options.scratch ? " y su scratch" : ""}; ${target} queda fuera. El padre habilita rutas con read_outside.`;
  }

  return null;
}

// A child never publishes, commits or installs dependencies. The contract says
// so in three prompts; here it is a rule.
const FORBIDDEN_COMMANDS =
  /\bgit\s+(?:add|commit|push|pull|checkout|switch|restore|reset|stash|clean|rebase|merge|tag|cherry-pick|revert|am)\b|\b(?:npm|pnpm|yarn)\s+(?:install|i|add|remove|uninstall|link|publish)\b|\bpip3?\s+install\b/;

export function subagentToolBlock(toolName, input = {}, cwd = process.cwd(), options = {}) {
  if (String(toolName).startsWith("po_shell_")) {
    return "Un subagente no puede usar tools de memoria, tareas, review ni estado de po-shell.";
  }

  const byRole = roleBlock(toolName, input, cwd, options);
  if (byRole) return byRole;

  const scratchViolation = testScratchViolation({ toolName, input, cwd });
  if (scratchViolation) return `Subagente: ${scratchViolation}`;

  const file = input.path ?? input.file_path ?? input.filename ?? input.file;
  if ((toolName === "write" || toolName === "edit") && file != null) {
    if (isMarkdown(file)) {
      return "Un subagente no puede escribir ni modificar archivos .md.";
    }
    if (isPoShellState(file)) {
      return "Un subagente no puede tocar el estado central.";
    }
    const surfaces = options.surfaces;
    if (String(options.role ?? "") === "worker" && (!Array.isArray(surfaces) || surfaces.length === 0)) {
      return "Un worker sin superficies declaradas no escribe: el padre tiene que fijarlas.";
    }
    if (Array.isArray(surfaces) && surfaces.length > 0 && !withinSurfaces(file, surfaces, cwd)) {
      return `Un subagente de escritura solo toca las superficies declaradas (${surfaces.join(", ")}); ${file} queda fuera.`;
    }
  }

  if (toolName === "bash" && typeof input.command === "string") {
    const command = input.command;
    const surfaces = options.surfaces;
    if (Array.isArray(surfaces) && surfaces.length > 0) {
      const targets = shellWriteTargets(command);
      const outside = targets.find((target) => !withinSurfaces(target, surfaces, cwd));
      if (outside) {
        return `Un subagente de escritura solo toca las superficies declaradas (${surfaces.join(", ")}); ${outside} queda fuera.`;
      }
    }
    if (
      /(?:>>?|tee|sed\s+-i|perl\s+-pi)[^;&|]*\.md\b/i.test(command) ||
      /\b(?:rm|mv|cp)\b[^;&|]*\.md\b/i.test(command)
    ) {
      return "Un subagente no puede modificar archivos .md desde bash.";
    }
    // Central state is off limits, except the child's own scratch: it lives
    // under ~/.po-shell/tmp/ and a reviewer has to write its probes somewhere.
    const central = shellWriteTargets(command)
      .filter((target) => isPoShellState(target))
      .map((target) => path.resolve(cwd, target))
      .filter((target) => !insideDir(target, options.scratch));
    if (central.length) {
      return `Un subagente no puede tocar el estado central desde bash; ${central[0]} está fuera de su scratch.`;
    }
    // No human is watching a child: every destructive form is refused, even the
    // ones the parent could confirm.
    const destructive = recognizeDestructive(command);
    if (destructive.length) {
      return `Un subagente no puede ejecutar comandos destructivos (${destructive[0].key}); devolvé un plan más seguro al padre.`;
    }

    // Git publication and dependency mutation are the parent's, always: a child
    // that commits leaves work nobody asked for, and one that installs changes
    // the tree the parent believes it controls.
    const forbidden = FORBIDDEN_COMMANDS.exec(command);
    if (forbidden) {
      return `Un subagente no puede correr \`${forbidden[0].trim()}\`: eso queda en manos del padre.`;
    }

    // A reviewer verifies by executing, but only inside its own copy: the repo is
    // read-only for it, so every write it makes has to land in its scratch.
    if (String(options.role ?? "") === "reviewer" && options.scratch) {
      const outsideScratch = shellWriteTargets(command)
        .map((target) => path.resolve(cwd, target))
        .find((target) => !insideDir(target, options.scratch) && !insideDir(target, cwd) === false);
      if (outsideScratch) {
        return `Un reviewer escribe solo en su copia scratch (${options.scratch}); ${outsideScratch} está fuera.`;
      }
    }
  }

  return null;
}
