import { recognizeDestructive } from "./destructive.js";
import { testScratchViolation } from "./scratch-guard.js";

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

export function subagentToolBlock(toolName, input = {}, cwd = process.cwd(), options = {}) {
  if (String(toolName).startsWith("po_shell_")) {
    return "Un subagente no puede usar tools de memoria, tareas, review ni estado de po-shell.";
  }

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
    if (/(?:>>?|tee|sed\s+-i|perl\s+-pi)[^;&|]*\.po-shell(?:\/|\b)/i.test(command)) {
      return "Un subagente no puede tocar el estado central desde bash.";
    }
    // No human is watching a child: every destructive form is refused, even the
    // ones the parent could confirm.
    const destructive = recognizeDestructive(command);
    if (destructive.length) {
      return `Un subagente no puede ejecutar comandos destructivos (${destructive[0].key}); devolvé un plan más seguro al padre.`;
    }
  }

  return null;
}
