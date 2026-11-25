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

/** Columns a code point occupies in a terminal: emoji and CJK are two. */
const WIDE_RANGES = [
  [0x1100, 0x115f],
  [0x2600, 0x27bf],
  [0x2e80, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe4f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f000, 0x1faff],
  [0x20000, 0x3fffd],
];

/**
 * Terminal columns of a string, not UTF-16 units: `📋` is one code point and two
 * columns, and a footer that trusts the unit count overflows the right edge.
 * Approximate on purpose: it covers the emoji and CJK ranges this chrome uses,
 * with no dependency and no grapheme table.
 */
export function textWidth(value) {
  let width = 0;
  for (const char of String(value ?? "")) {
    const code = char.codePointAt(0);
    if (code === 0xfe0f || code === 0x200d) continue;
    width += WIDE_RANGES.some(([start, end]) => code >= start && code <= end) ? 2 : 1;
  }
  return width;
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
  if (textWidth(text) <= width) return text;
  let out = "";
  for (const char of String(text ?? "")) {
    if (textWidth(`${out}${char}…`) > width) break;
    out += char;
  }
  return `${out.trimEnd()}…`;
}

/** At least two columns between the two blocks, more when the terminal is wide. */
export const FOOTER_GAP = 2;

function blockText(parts) {
  return parts.map((part) => part.text).join(FOOTER_SEP);
}

/** Project on the left, the model on the right, the gap stretched between. */
function padRow(width, left, right) {
  const l = blockText(left);
  const r = blockText(right);
  if (!r) return l;
  if (!l) return width > 0 ? `${" ".repeat(Math.max(0, width - textWidth(r)))}${r}` : r;
  const gap = width > 0 ? Math.max(FOOTER_GAP, width - textWidth(l) - textWidth(r)) : FOOTER_GAP;
  return `${l}${" ".repeat(gap)}${r}`;
}

/**
 * The one-line footer, shrunk to `width`.
 *
 * Two blocks: `left` is the project (path, branch, task phase), `right` is the
 * model (credits, context, model name), flush against the right edge. Both are
 * `[{ text, compact?, keep? }]`. Shrinking is a cascade, not a truncation:
 * first every part that offers a `compact` form takes it, then the parts
 * without `keep` are dropped, project first and the model last. Credits and
 * context never leave: they are the reason the line exists. Only when even the
 * model block does not fit is anything cut.
 */
export function footerLine(blocks, options = {}) {
  const width = Math.max(0, Math.trunc(Number(options.width) || 0));
  const clean = (parts) =>
    (Array.isArray(parts) ? parts : [])
      .filter((part) => part && typeof part.text === "string" && part.text.length > 0)
      .map((part) => ({ ...part }));

  const left = clean(blocks?.left);
  const right = clean(blocks?.right);
  const row = () => padRow(width, left, right);

  if (!width) return row();

  for (const part of [...left, ...right]) {
    if (textWidth(row()) <= width) break;
    if (part.compact && part.compact !== part.text) part.text = part.compact;
  }

  for (const parts of [left, right]) {
    let index = 0;
    while (textWidth(row()) > width && index < parts.length) {
      if (parts[index].keep) index += 1;
      else parts.splice(index, 1);
    }
  }

  const line = row();
  if (textWidth(line) <= width) return line;
  // Too narrow even for the model block: cut that block, not the padding.
  return cutWidth(blockText(right) || line, width);
}
