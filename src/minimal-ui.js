/**
 * One-line display for tool calls and results.
 *
 * Pure: no theme, no components, no I/O. The extension turns these strings into
 * `Text` with the theme colors; the tests assert the strings.
 */

import path from "node:path";

/** Icon, tone and label per tool. Tones are pi theme color names. */
export const TOOL_STYLE = {
  bash: { icon: "🐚", tone: "accent" },
  edit: { icon: "✏", tone: "warning" },
  write: { icon: "📝", tone: "warning" },
  read: { icon: "📖", tone: "muted" },
  grep: { icon: "🔍", tone: "muted" },
  find: { icon: "🔎", tone: "muted" },
  ls: { icon: "📁", tone: "muted" },
  po_shell_status: { icon: "📊", tone: "accent" },
  po_shell_task: { icon: "📋", tone: "accent" },
  po_shell_memory: { icon: "🧠", tone: "accent" },
  po_shell_check: { icon: "✅", tone: "success" },
  po_shell_review: { icon: "🔒", tone: "accent" },
  po_shell_ask: { icon: "❓", tone: "warning" },
  po_shell_delegate: { icon: "🤖", tone: "accent" },
  context_search: { icon: "🔍", tone: "muted" },
  context_get: { icon: "📄", tone: "muted" },
};

export const DEFAULT_STYLE = { icon: "•", tone: "muted" };
export const MAX_TEXT = 72;
export const MAX_RESULT = 90;

export function toolStyle(name) {
  return TOOL_STYLE[String(name ?? "")] ?? DEFAULT_STYLE;
}

/** Collapse whitespace and cut to `max` characters, with an ellipsis. */
export function oneLine(value, max = MAX_TEXT) {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

/** Repo-relative when inside `cwd`, home-relative otherwise. */
export function shortPath(file, cwd) {
  const value = String(file ?? "").trim();
  if (!value) return "";
  const base = path.resolve(cwd ?? process.cwd());
  const absolute = path.isAbsolute(value) ? value : path.resolve(base, value);
  const relative = path.relative(base, absolute);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) return relative;
  const home = process.env.HOME ?? "";
  if (home && absolute.startsWith(`${home}${path.sep}`)) {
    return `~/${path.relative(home, absolute)}`;
  }
  return absolute;
}

export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m${String(seconds).padStart(2, "0")}s`;
}

export function lineCount(value) {
  const text = String(value ?? "");
  if (!text) return 0;
  return text.split("\n").length;
}

/** Added and removed lines across an edit call. */
export function editStats(edits) {
  let added = 0;
  let removed = 0;
  for (const edit of Array.isArray(edits) ? edits : []) {
    added += lineCount(edit?.newText);
    removed += lineCount(edit?.oldText);
  }
  return { added, removed };
}

/** Text out of a tool result: content parts of type text, joined. */
export function resultText(result) {
  const content = result?.content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function firstLine(text) {
  return String(text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? "";
}

function range(args) {
  const offset = Number(args?.offset);
  const limit = Number(args?.limit);
  if (!Number.isFinite(offset) && !Number.isFinite(limit)) return "";
  const start = Number.isFinite(offset) ? offset + 1 : 1;
  const end = Number.isFinite(limit) ? start + limit - 1 : "";
  return `:${start}-${end}`;
}

/**
 * The collapsed call row: `{ icon, tone, text, meta }`.
 * `text` is the primary string, `meta` the dim detail at the end.
 */
export function formatCall(name, args = {}, options = {}) {
  const style = toolStyle(name);
  const cwd = options.cwd;

  switch (name) {
    case "bash":
      return { ...style, text: oneLine(args.command, MAX_TEXT) || "(comando)", meta: "" };
    case "edit": {
      const { added, removed } = editStats(args.edits);
      return {
        ...style,
        text: shortPath(args.path, cwd),
        meta: `${added ? `+${added}` : ""}${added && removed ? " " : ""}${removed ? `−${removed}` : ""}`,
      };
    }
    case "write":
      return {
        ...style,
        text: shortPath(args.path, cwd),
        meta: `${lineCount(args.content)} L`,
      };
    case "read":
      return { ...style, text: `${shortPath(args.path, cwd)}${range(args)}`, meta: "" };
    case "grep":
      return {
        ...style,
        text: oneLine(args.pattern, 40),
        meta: args.path ? shortPath(args.path, cwd) : "",
      };
    case "find":
      return {
        ...style,
        text: oneLine(args.pattern, 40),
        meta: args.path ? shortPath(args.path, cwd) : "",
      };
    case "ls":
      return { ...style, text: shortPath(args.path || ".", cwd), meta: "" };
    case "po_shell_task": {
      const action = oneLine(args.action, 12);
      const subject = oneLine(args.title || args.id || "", 46);
      return { ...style, text: subject ? `task · ${action} · ${subject}` : `task · ${action}`, meta: "" };
    }
    case "po_shell_memory": {
      const action = oneLine(args.action, 10);
      const subject = oneLine(args.query || args.title || args.topic || "", 44);
      return { ...style, text: subject ? `memory · ${action} · ${subject}` : `memory · ${action}`, meta: "" };
    }
    case "po_shell_review":
      return { ...style, text: `review · ${oneLine(args.action || "", 12)}`, meta: "" };
    case "po_shell_ask":
      return { ...style, text: oneLine(args.question, MAX_TEXT), meta: "" };
    case "po_shell_delegate": {
      const role = oneLine(args.role || "worker", 12);
      return { ...style, text: `delegate · ${role}`, meta: oneLine(args.task, 40) };
    }
    case "po_shell_check":
      return { ...style, text: "check", meta: "" };
    case "po_shell_status":
      return { ...style, text: "status", meta: "" };
    case "context_search":
      return { ...style, text: oneLine(args.query, MAX_TEXT), meta: "" };
    case "context_get":
      return { ...style, text: oneLine(args.id, MAX_TEXT), meta: "" };
    default:
      return { ...style, text: oneLine(name, MAX_TEXT), meta: "" };
  }
}

/**
 * The collapsed result rows: `[{ text, tone }]`.
 * Empty array means "nothing to add": the call row already says it all.
 */
export function formatResult(name, args = {}, result, options = {}) {
  const text = resultText(result);
  const lines = text.split("\n").filter((line) => line.trim().length > 0);

  if (options.isPartial) {
    const last = lines[lines.length - 1] ?? "";
    return [{ tone: "dim", text: last ? oneLine(last, MAX_RESULT) : "⋯" }];
  }

  if (options.isError) {
    const head = lines.slice(0, 3).map((line) => oneLine(line, MAX_RESULT));
    if (head.length === 0) return [{ tone: "error", text: "✗ falló sin salida" }];
    return head.map((line, index) => ({
      tone: "error",
      text: index === 0 ? `✗ ${line}` : `  ${line}`,
    }));
  }

  const duration = formatDuration(options.durationMs);

  switch (name) {
    case "bash":
      return duration ? [{ tone: "success", text: `✓ ${duration}` }] : [];
    case "edit":
    case "write":
      return [];
    case "read":
      return [];
    case "grep":
    case "find":
    case "ls": {
      const count = lines.length;
      return count ? [{ tone: "muted", text: `${count} ${count === 1 ? "resultado" : "resultados"}` }] : [];
    }
    default: {
      const head = firstLine(text);
      if (!head) return [];
      const extra = lines.length > 1 ? ` +${lines.length - 1}` : "";
      return [{ tone: "muted", text: `${oneLine(head, MAX_RESULT)}${extra}` }];
    }
  }
}
