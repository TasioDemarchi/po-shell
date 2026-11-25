/**
 * One-line display for tool calls and results.
 *
 * Pure: no theme, no components, no I/O. The extension turns these strings into
 * `Text` with the theme colors; the tests assert the strings.
 */

import path from "node:path";

/**
 * Icon, tone and label per tool. Tones are pi theme color names.
 * The label is the word that says what happened; the icon alone does not.
 * Chrome words are English, by project rule.
 */
export const TOOL_STYLE = {
  bash: { icon: "🐚", tone: "accent", label: "shell" },
  // U+270F plus VS16: the bare pencil is a one-cell dingbat, the only icon
  // narrower than the rest, and that is what swallowed the gap before the word.
  edit: { icon: "✏️", tone: "warning", label: "edit" },
  write: { icon: "📝", tone: "warning", label: "write" },
  read: { icon: "📖", tone: "muted", label: "read" },
  grep: { icon: "🔍", tone: "muted", label: "search" },
  find: { icon: "🔎", tone: "muted", label: "search" },
  ls: { icon: "📁", tone: "muted", label: "list" },
  po_shell_status: { icon: "📊", tone: "accent", label: "status" },
  po_shell_task: { icon: "📋", tone: "accent", label: "task" },
  po_shell_memory: { icon: "🧠", tone: "accent", label: "memory" },
  po_shell_check: { icon: "✅", tone: "success", label: "check" },
  po_shell_review: { icon: "🔒", tone: "accent", label: "review" },
  po_shell_ask: { icon: "❓", tone: "warning", label: "ask" },
  po_shell_delegate: { icon: "🤖", tone: "accent", label: "delegate" },
  context_search: { icon: "🔍", tone: "muted", label: "search" },
  context_get: { icon: "📄", tone: "muted", label: "get" },
};

export const DEFAULT_STYLE = { icon: "•", tone: "muted", label: "" };
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
 * The collapsed call row: `{ icon, tone, label, text, meta }`.
 * `label` is the English word for the action, `text` the subject, `meta` the
 * dim detail at the end. The renderer joins them as `icon label text  meta`.
 */
export function formatCall(name, args = {}, options = {}) {
  const style = toolStyle(name);
  const cwd = options.cwd;

  switch (name) {
    case "bash":
      return { ...style, text: oneLine(args.command, MAX_TEXT) || "(command)", meta: "" };
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
      return { ...style, text: subject ? `${action} · ${subject}` : action, meta: "" };
    }
    case "po_shell_memory": {
      const action = oneLine(args.action, 10);
      const subject = oneLine(args.query || args.title || args.topic || "", 44);
      return { ...style, text: subject ? `${action} · ${subject}` : action, meta: "" };
    }
    case "po_shell_review":
      return { ...style, text: oneLine(args.action || "", 12), meta: "" };
    case "po_shell_ask":
      return { ...style, text: oneLine(args.question, MAX_TEXT), meta: "" };
    case "po_shell_delegate": {
      const role = oneLine(args.role || "worker", 12);
      return { ...style, text: role, meta: oneLine(args.task, 40) };
    }
    case "po_shell_check":
    case "po_shell_status":
      return { ...style, text: "", meta: "" };
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
    if (head.length === 0) return [{ tone: "error", text: "✗ failed with no output" }];
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
      return count ? [{ tone: "muted", text: `${count} ${count === 1 ? "result" : "results"}` }] : [];
    }
    default: {
      const head = firstLine(text);
      if (!head) return [];
      const extra = lines.length > 1 ? ` +${lines.length - 1}` : "";
      return [{ tone: "muted", text: `${oneLine(head, MAX_RESULT)}${extra}` }];
    }
  }
}

/* --------------------------------- footer -------------------------------- */

export const FOOTER_SEP = " · ";

/** Length in code points: enough for a footer, and no dependency. */
export function textWidth(value) {
  return [...String(value ?? "")].length;
}

/** Changed entries in `git status --porcelain`: one line per changed path. */
export function dirtyCount(porcelain) {
  return String(porcelain ?? "")
    .split("\n")
    .filter((line) => line.trim().length > 0).length;
}

/** `main`, or `main ±3` when the worktree is dirty. Empty without a branch. */
export function gitLabel(branch, dirty) {
  const name = oneLine(branch, 40);
  if (!name) return "";
  const count = Math.max(0, Math.trunc(Number(dirty) || 0));
  return count > 0 ? `${name} ±${count}` : name;
}

/** Home-relative path: `~/dev/po-shell`, or the absolute path outside home. */
export function homePath(target, home = process.env.HOME ?? "") {
  const absolute = path.resolve(String(target ?? "."));
  const base = String(home ?? "");
  if (base && absolute === base) return "~";
  if (base && absolute.startsWith(`${base}${path.sep}`)) {
    return `~/${path.relative(base, absolute)}`;
  }
  return absolute;
}

/** `18.6cr`, `0.31cr`, `0cr`; `~` when a model in the session had no rates. */
export function creditLabel(credits, options = {}) {
  const value = Number(credits) || 0;
  if (value <= 0) return options.known === false ? "~0cr" : "0cr";
  const body = `${value >= 10 ? value.toFixed(1) : value.toFixed(2)}cr`;
  return options.known === false ? `~${body}` : body;
}

/** `ctx 12%`; `ctx ?` right after a compaction, when Pi has no estimate yet. */
export function contextLabel(percent) {
  const value = Number(percent);
  if (percent === null || percent === undefined || !Number.isFinite(value)) return "ctx ?";
  return `ctx ${Math.round(value)}%`;
}

/** `deepseek-v4-flash · low`, or just the model without a thinking level. */
export function modelLabel(model, thinking) {
  const name = oneLine(model, 40);
  const level = oneLine(thinking, 12);
  if (!name) return level;
  return level ? `${name} · ${level}` : name;
}

/** The model's family word: `deepseek-v4-flash` → `flash`. */
export function shortModel(model) {
  const name = oneLine(model, 40);
  if (!name) return "";
  return oneLine(name.split("-").filter(Boolean).pop(), 12);
}

/** `📋 ready`, or empty with no active task. */
export function taskLabel(task) {
  const phase = oneLine(task?.phase, 12);
  return phase ? `📋 ${phase}` : "";
}

function cutWidth(text, width) {
  const chars = [...text];
  if (chars.length <= width) return text;
  return `${chars.slice(0, Math.max(1, width - 1)).join("").trimEnd()}…`;
}

/**
 * The one-line footer, shrunk to `width`.
 *
 * `parts` is `[{ text, compact?, keep? }]` in display order. Shrinking is a
 * cascade, not a truncation: first every part that offers a `compact` form
 * takes it (path → basename, `main ±3` → `main`, model → family word), then the
 * parts without `keep` are dropped, and only as a last resort the line is cut.
 * Credits and context are the last to go, as the design says.
 */
export function footerLine(parts, options = {}) {
  const width = Math.max(0, Math.trunc(Number(options.width) || 0));
  const items = (Array.isArray(parts) ? parts : [])
    .filter((part) => part && typeof part.text === "string" && part.text.length > 0)
    .map((part) => ({ ...part }));
  const render = () => items.map((part) => part.text).join(FOOTER_SEP);

  if (!width) return render();

  for (const item of items) {
    if (textWidth(render()) <= width) break;
    if (item.compact && item.compact !== item.text) item.text = item.compact;
  }

  let index = 0;
  while (textWidth(render()) > width && index < items.length) {
    if (items[index].keep) index += 1;
    else items.splice(index, 1);
  }

  return cutWidth(render(), width);
}
