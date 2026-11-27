/**
 * One-line display for tool calls and results.
 *
 * Pure: no theme, no components, no I/O. The extension turns these strings into
 * `Text` with the theme colors; the tests assert the strings.
 */

import path from "node:path";

/**
 * Marker, tone and label per tool. Tones are pi theme color names.
 *
 * The label is the word that says what happened; the marker is a one-cell ASCII
 * glyph. Emoji were tempting and wrong: a font without coverage draws them as a
 * box (▯), so the row lost its marker exactly where it mattered.
 */
export const TOOL_STYLE = {
  bash: { icon: "$", tone: "accent", label: "shell" },
  read: { icon: ":", tone: "muted", label: "read" },
  write: { icon: "+", tone: "warning", label: "write" },
  edit: { icon: "~", tone: "warning", label: "edit" },
  grep: { icon: "/", tone: "muted", label: "search" },
  find: { icon: "/", tone: "muted", label: "search" },
  context_search: { icon: "/", tone: "muted", label: "search" },
  ls: { icon: ".", tone: "muted", label: "list" },
  context_get: { icon: "^", tone: "muted", label: "get" },
  web_fetch: { icon: "@", tone: "muted", label: "web" },
  web_search: { icon: "@", tone: "muted", label: "web" },
  po_shell_task: { icon: "#", tone: "accent", label: "task" },
  po_shell_memory: { icon: "=", tone: "accent", label: "memory" },
  po_shell_check: { icon: "!", tone: "success", label: "check" },
  po_shell_ask: { icon: "?", tone: "warning", label: "ask" },
  po_shell_review: { icon: "%", tone: "accent", label: "review" },
  po_shell_delegate: { icon: ">", tone: "accent", label: "delegate" },
  po_shell_status: { icon: "*", tone: "accent", label: "status" },
};

export const DEFAULT_STYLE = { icon: "·", tone: "muted", label: "" };
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

/**
 * `https://example.com/docs/a?q=1` → `example.com/docs/a?q=1`, cut from the
 * end. `shortPath` is wrong here: a URL is not a file, and its head (the host)
 * is the part that says where we went, so the path is what gets shortened.
 */
export function urlLabel(value, max = MAX_TEXT) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  let label = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  try {
    const parsed = new URL(raw);
    const tail = `${parsed.pathname === "/" ? "" : parsed.pathname}${parsed.search}`;
    label = `${parsed.host}${tail}`;
  } catch {
    // Not a URL: keep the string and cut it from the end, never from the host.
  }
  return oneLine(label, max);
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

/** Result lines that say something, in order. */
function nonEmptyLines(text) {
  return String(text ?? "")
    .split("\n")
    .filter((line) => line.trim().length > 0);
}

/** `role: worker` → `worker`; "" when the line is not there. */
function fieldOf(lines, name) {
  const prefix = `${name}:`;
  const line = lines.find((value) => value.trim().startsWith(prefix));
  return line ? line.trim().slice(prefix.length).trim() : "";
}

// Pi appends this status to a failed shell result; it is the exit code, not content.
const EXIT_LINE = /\bexited with code \d+\b/i;
const EXIT_CODE = /\bexited with code (\d+)\b/i;

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
    case "web_fetch":
      return { ...style, text: urlLabel(args.url || args.query, MAX_TEXT), meta: "" };
    case "web_search":
      return { ...style, text: oneLine(args.query || args.url, MAX_TEXT), meta: "" };
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
 * What one tool did, in the one line the bottom rule can hold. Every tool says
 * something: a footer that only repeats the call is a dead rule.
 */
function summarize(name, args = {}, text = "", lines = [], options = {}) {
  const duration = formatDuration(options.durationMs);
  const status = options.isError ? "fail" : "ok";

  switch (name) {
    case "bash": {
      // The output is the body's job; the footer is only the outcome and its
      // cost. The exit code is state, not output, so a failure keeps it.
      const code = EXIT_CODE.exec(text)?.[1] ?? "";
      const parts = [status];
      if (options.isError && code) parts.push(`exit ${code}`);
      if (duration) parts.push(duration);
      return { text: oneLine(parts.join(" · "), MAX_RESULT), tone: options.isError ? "error" : "success" };
    }
    case "po_shell_memory": {
      // The key already rides the call row; the footer says only whether it
      // landed. A search says whether it found anything, never the raw text.
      const action = oneLine(args.action, 10);
      if (action === "search" || (!action && args.query)) {
        if (options.isError) return { text: "none", tone: "error" };
        const found =
          lines.some((line) => line.trim().startsWith("## ")) || /global memory found/i.test(text);
        return found ? { text: "found", tone: "success" } : { text: "none", tone: "muted" };
      }
      if (options.isError) return { text: "not saved", tone: "error" };
      const saved = /Memoria guardada/i.test(text) || lines.length > 0;
      return saved ? { text: "saved", tone: "success" } : { text: "not saved", tone: "error" };
    }
    case "read": {
      const count = lineCount(String(text ?? "").replace(/\s+$/, ""));
      return { text: `${count} ${count === 1 ? "line" : "lines"}`, tone: "muted" };
    }
    case "edit": {
      // The `+N −M` already rides the top rule: repeating it here is the dead
      // rule this section exists to kill.
      const { added, removed } = editStats(args.edits);
      if (!added && !removed) return { text: "no changes", tone: "muted" };
      return { text: "applied", tone: "success" };
    }
    case "write": {
      const count = lineCount(args.content);
      return { text: `${count} ${count === 1 ? "line" : "lines"}`, tone: "success" };
    }
    case "grep":
    case "find":
    case "ls": {
      const count = lines.length;
      if (!count) return { text: "no matches", tone: "muted" };
      return { text: `${count} ${count === 1 ? "result" : "results"}`, tone: "muted" };
    }
    case "po_shell_check": {
      // `PASS npm test (exit 0, 12ms)` per check, then the task it was recorded on.
      const verdicts = lines.filter((line) => /^(PASS|FAIL)\b/.test(line.trim()));
      const failed = verdicts.filter((line) => /^FAIL\b/.test(line.trim())).length;
      const passed = verdicts.length - failed;
      const task = fieldOf(lines, "Tarea").split("·")[0].trim();
      const parts = [failed > 0 ? "FAIL" : "PASS"];
      if (verdicts.length) parts.push(`${passed}/${verdicts.length}`);
      if (task) parts.push(task);
      if (!verdicts.length) {
        const head = firstLine(text);
        if (head) parts.push(head);
      }
      return { text: oneLine(parts.join(" · "), MAX_RESULT), tone: failed > 0 ? "error" : "success" };
    }
    case "po_shell_delegate": {
      // A settled delegation reads its cost from `details` (turns, time), never
      // from a number parsed out of the report.
      const details = options.details;
      if (details) {
        const state = oneLine(details.status, 16) || (options.isError ? "fail" : "ok");
        // The cost is a result, so it belongs in the footer, never in the call row.
        const credits = Number.isFinite(details.credits) ? creditLabel(details.credits) : "no cost";
        const parts = [state, credits];
        const turns = details.turns;
        if (Number.isFinite(turns) && turns >= 0) {
          parts.push(`${turns} ${turns === 1 ? "turn" : "turns"}`);
        }
        if (Number.isFinite(details.ms) && details.ms >= 0) parts.push(formatDuration(details.ms));
        return {
          text: oneLine(parts.filter(Boolean).join(" · "), MAX_RESULT),
          tone: state === "ok" ? "success" : "error",
        };
      }
      const role = fieldOf(lines, "role") || oneLine(args.role, 16);
      const state = fieldOf(lines, "status");
      const turns = fieldOf(lines, "turns");
      const parts = [role || "delegate"];
      if (state) parts.push(state);
      if (turns) parts.push(`turns ${turns}`);
      if (parts.length === 1) {
        const head = firstLine(text);
        return {
          text: oneLine(head || "delegated", MAX_RESULT),
          tone: options.isError || (state && state !== "ok") ? "error" : "muted",
        };
      }
      return {
        text: oneLine(parts.join(" · "), MAX_RESULT),
        tone: options.isError || (state && state !== "ok") ? "error" : "success",
      };
    }
    default: {
      const head = lines.find((line) => !EXIT_LINE.test(line)) ?? "";
      if (!head) return { text: status, tone: options.isError ? "error" : "muted" };
      const extra = lines.length > 1 ? ` +${lines.length - 1}` : "";
      return {
        text: oneLine(options.isError ? `fail · ${head}` : `${head}${extra}`, MAX_RESULT),
        tone: options.isError ? "error" : "muted",
      };
    }
  }
}

/**
 * The collapsed result rows: `[{ text, tone }]`, never empty.
 *
 * The first row rides the bottom rule; the error tail (`  line`) goes below the
 * frame, because a cut reason is not a reason. Tools that own their error
 * vocabulary (`po_shell_check`, `po_shell_delegate`) say it all in the first row.
 */
export function formatResult(name, args = {}, result, options = {}) {
  const text = resultText(result);
  const lines = nonEmptyLines(text);
  const details = delegationDetails(result);

  // A delegation that has not settled says only that: no turns and no credits
  // invented out of half a report. `details` is what settles it; a result with
  // no details and no text yet is a delegation still running.
  const pending =
    name === "po_shell_delegate" &&
    !options.isError &&
    (Boolean(options.isPartial) || !result || (!details && !text));
  if (pending) return [{ tone: "dim", text: DELEGATE_RUNNING }];

  if (options.isPartial) {
    const last = lines[lines.length - 1] ?? "";
    return [{ tone: "dim", text: last ? oneLine(last, MAX_RESULT) : "⋯" }];
  }

  const summary = summarize(name, args, text, lines, { ...options, details });
  const rows = [{ tone: summary.tone, text: summary.text }];
  const ownsError = name === "po_shell_check" || name === "po_shell_delegate";
  if (options.isError && !ownsError) {
    // The bash footer carries no output text any more, so its first line is not
    // spent above the frame and the reasons start at the top. Other tools keep
    // the head in the summary, and repeating it below would be the dead rule.
    const reasons = lines.filter((value) => !EXIT_LINE.test(value));
    const start = name === "bash" ? 0 : 1;
    for (const line of reasons.slice(start, start + 2)) {
      rows.push({ tone: "error", text: `  ${oneLine(line, MAX_RESULT)}` });
    }
  }
  return rows;
}

/**
 * A finished delegation's `details`; null while it runs or when the tool sent
 * none. The frame reads these, never the report text.
 */
function delegationDetails(result) {
  const details = result && typeof result === "object" ? result.details : null;
  if (!details || typeof details !== "object") return null;
  return String(details.status ?? "").trim() === "running" ? null : details;
}

/* --------------------------------- frame --------------------------------- */

/**
 * The collapsed call, drawn as a two-line rounded frame: the row rides the top
 * rule and the result meta the bottom one, so the whole thing reads as one
 * block instead of two flat lines.
 */
/** The one key that expands the body, named the same in both modes. */
export const FRAME_HINT = "ctrl+o";
/** What the bottom rule says while a delegation has not settled yet. */
export const DELEGATE_RUNNING = "running…";
/** Below this the frame is a stamp: the extension clamps the terminal width here. */
export const FRAME_MIN_WIDTH = 40;
/** The collapsed body never grows past three lines: the rest is a count. */
export const FRAME_BODY_LINES = 3;
/** The expanded body's ceiling: past this a dump would freeze the TUI. */
export const FRAME_BODY_MAX = 400;
/** Source lines a collapsed edit body reads before it stops scraping its hunks. */
const FRAME_EDIT_SOURCE = 6;

const FRAME_CORNER = { topLeft: "╭", topRight: "╮", bottomLeft: "╰", bottomRight: "╯" };
const FRAME_RULE = "─";
// `╭─ ` + one space before the fill + `─╮`.
const FRAME_CHROME = 6;
// A subject narrower than this says nothing, so the call meta leaves first.
const FRAME_MIN_SUBJECT = 6;

function dashes(count) {
  return FRAME_RULE.repeat(Math.max(0, count));
}

function segmentsWidth(segments) {
  return segments.reduce((sum, segment) => sum + textWidth(segment.text), 0);
}

/** A drawn line: the plain string the tests assert and the pieces the caller colors. */
function frameLine(segments) {
  return { text: segments.map((segment) => segment.text).join(""), segments };
}

/** The call row split by role: icon, label, subject and call meta. */
function rowSegments(call, subject) {
  const segments = [{ kind: "icon", text: call.icon }];
  if (call.label) segments.push({ kind: "label", text: ` ${call.label}` });
  if (subject) {
    segments.push({ kind: "label", text: " · " }, { kind: "subject", text: subject });
  }
  if (call.meta) segments.push({ kind: "callMeta", text: `  ${call.meta}` });
  return segments;
}

/** The row shrunk to `budget` columns: the subject loses characters, the label never. */
function fitRowSegments(call, budget) {
  const full = rowSegments(call, call.text);
  if (segmentsWidth(full) <= budget) return full;

  const prefix = 1 + (call.label ? 1 + textWidth(call.label) : 0);
  const separator = call.text ? 3 : 0;
  const metaColumns = call.meta ? 2 + textWidth(call.meta) : 0;
  let meta = call.meta;
  let room = budget - prefix - separator - metaColumns;
  if (meta && room < FRAME_MIN_SUBJECT) {
    meta = "";
    room = budget - prefix - separator;
  }
  const subject = call.text ? cutWidth(call.text, Math.max(1, room)) : "";
  return rowSegments({ ...call, meta }, subject);
}

/** The top-rule right side: only the hint. The outcome lives in the footer. */
function rightSide(hint, withHint) {
  return withHint && hint ? hint : "";
}

/** The drawn top rule: the row, the fill, and the right side flush against it. */
function topSegments(row, budget, right) {
  const fill = Math.max(0, budget - segmentsWidth(row));
  const segments = [{ kind: "border", text: `${FRAME_CORNER.topLeft}${FRAME_RULE} ` }, ...row];
  segments.push({ kind: "border", text: " " }, { kind: "border", text: dashes(fill) });
  if (right) segments.push({ kind: "hint", text: ` ${right} ` });
  segments.push({ kind: "border", text: `${FRAME_RULE}${FRAME_CORNER.topRight}` });
  return frameLine(segments);
}

/**
 * `╭─ $ shell · npm test ───── ctrl+o ─╮`: the row in the top rule and the hint
 * flush right. The hint leaves before the subject is cut; nothing else rides it.
 */
function topLine(call, width, hint) {
  const plainBudget = Math.max(0, width - FRAME_CHROME);
  const full = rowSegments(call, call.text);
  const fullWidth = segmentsWidth(full);

  for (const withHint of [true, false]) {
    const right = rightSide(hint, withHint);
    const budget = Math.max(0, plainBudget - (right ? textWidth(right) + 2 : 0));
    if (fullWidth <= budget) return topSegments(full, budget, right);
  }
  // Nothing fits whole: the subject is what gets cut, and the hint goes with it.
  return topSegments(fitRowSegments(call, plainBudget), plainBudget, "");
}

/** `╰─ ✓ 12ms ─────╯`, or `╰─────╯` when the result adds nothing. */
function bottomLine(meta, tone, width) {
  if (!meta) {
    return frameLine([
      { kind: "border", text: FRAME_CORNER.bottomLeft },
      { kind: "border", text: dashes(width - 2) },
      { kind: "border", text: FRAME_CORNER.bottomRight },
    ]);
  }
  const text = cutWidth(meta, Math.max(1, width - 5));
  const fill = Math.max(0, width - 5 - textWidth(text));
  return frameLine([
    { kind: "border", text: `${FRAME_CORNER.bottomLeft}${FRAME_RULE} ` },
    { kind: tone, text },
    { kind: "border", text: " " },
    { kind: "border", text: dashes(fill) },
    { kind: "border", text: FRAME_CORNER.bottomRight },
  ]);
}

/**
 * What goes in the bottom rule, and what cannot: the first error line is the
 * meta, the rest of the error is content and falls below the frame.
 */
function resultFrame(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return { meta: "", tone: "muted", extra: [] };
  const [first, ...rest] = list;
  if (first.tone === "error") {
    return {
      meta: first.text,
      tone: "error",
      extra: rest.map((row) => ({ kind: "error", text: `  ${String(row.text).trim()}` })),
    };
  }
  return { meta: list.map((row) => row.text).join(" · "), tone: first.tone, extra: [] };
}

/**
 * The body, chosen by tool, plus what did not fit: every non-empty result line
 * when expanded, the collapsed three otherwise.
 *
 * Collapsed, the verdict of a successful shell lives in its last lines, so it
 * shows the tail; a failure shows the head. An edit shows its first changed
 * lines with `-`/`+`; every other tool shows the first lines of its result.
 * Expanded, the body is the whole result — every hunk of an edit — up to
 * `FRAME_BODY_MAX`, because a cut body is the one thing `ctrl+o` is for.
 */
function bodySource(name, args, result, options) {
  if (!result || options.isPartial) return { lines: [], overflow: 0 };
  const lines = nonEmptyLines(resultText(result));
  const expanded = Boolean(options.expanded);

  if (name === "edit") {
    const source = [];
    const scrape = expanded ? FRAME_BODY_MAX : FRAME_EDIT_SOURCE;
    for (const edit of Array.isArray(args.edits) ? args.edits : []) {
      for (const [prefix, value] of [
        ["-", edit?.oldText],
        ["+", edit?.newText],
      ]) {
        for (const line of String(value ?? "").split("\n")) {
          if (source.length >= scrape) break;
          if (!line.trim()) continue;
          source.push(`${prefix} ${line}`);
        }
      }
      if (source.length >= scrape) break;
    }
    const { added, removed } = editStats(args.edits);
    const body = source.slice(0, expanded ? FRAME_BODY_MAX : FRAME_BODY_LINES);
    // The totals are the whole change, not the slice that fit in the frame.
    return { lines: body, overflow: Math.max(0, added + removed - body.length) };
  }

  if (expanded) {
    const body = lines.slice(0, FRAME_BODY_MAX);
    return { lines: body, overflow: Math.max(0, lines.length - body.length) };
  }

  const tail = name === "bash" && !options.isError;
  const picked = tail ? lines.slice(-FRAME_BODY_LINES) : lines.slice(0, FRAME_BODY_LINES);
  return { lines: picked, overflow: Math.max(0, lines.length - picked.length) };
}

/**
 * The frame: `{ tone, top, bottom, body, meta, extra, overflow }`.
 *
 * `top`/`bottom` are lines (`{ text, segments }`); every segment carries a
 * `kind` the extension turns into a theme tone — `border`, `label`, `hint` and
 * `callMeta` are dim, `icon` takes the call tone, `subject` is text, and the
 * result meta keeps the tone `formatResult` gave it. `extra` rows
 * (`{ text, kind }`) go below the bottom rule, colored `error`. `width` is
 * honored exactly; the caller clamps it to the terminal and to
 * `FRAME_MIN_WIDTH`.
 *
 * Collapsed is always two lines: `body` is empty and only `renderResult` draws
 * the bottom. Expanded keeps the same two rules and puts the prepared body
 * (`{ text }`, already cut to the inner width) between them; `overflow` is how
 * many lines were dropped and `0` when everything fit.
 */
export function formatFrame(name, args = {}, result = null, options = {}) {
  const width = Math.max(4, Math.trunc(Number(options.width) || 80));
  const expanded = Boolean(options.expanded);
  const call = formatCall(name, args, { cwd: options.cwd });
  const rows = result
    ? formatResult(name, args, result, {
        isPartial: options.isPartial,
        isError: options.isError,
        durationMs: options.durationMs,
      })
    : name === "po_shell_delegate" && !options.isError
      ? [{ tone: "dim", text: DELEGATE_RUNNING }]
      : [];
  const { meta, tone, extra } = resultFrame(rows);
  const picked = expanded
    ? bodySource(name, args, result, { ...options, expanded })
    : { lines: [], overflow: 0 };
  const bodyWidth = Math.max(1, width - FRAME_CHROME);
  return {
    tone: call.tone,
    top: topLine(call, width, FRAME_HINT),
    bottom: bottomLine(meta, tone, width),
    body: picked.lines.map((text) => ({ text: cutWidth(`  ${text}`, bodyWidth) })),
    meta,
    extra,
    overflow: picked.overflow,
  };
}

/* ------------------------------- isolation ------------------------------ */

/** What a worktree protects, in the one line the dialog can afford. */
export const ISOLATION_PROTECTS =
  "In a worktree the child writes on its own branch: your tree and your git status stay untouched, and discarding its work is two commands instead of a hand merge.";

export const ISOLATION_MIN_REASON = 20;

/**
 * The dialog that asks a human to isolate a task.
 *
 * `reason` is the orchestrator's: two lines about this project and this mission.
 * The rest is chrome and stays in English. A reason too short to say anything is
 * refused, because a dialog that does not explain itself is a button.
 */
export function isolationPrompt({ handle, reason, isolate = true } = {}) {
  const why = String(reason ?? "").trim();
  if (why.length < ISOLATION_MIN_REASON) {
    throw new Error(
      `an isolation request needs a reason of at least ${ISOLATION_MIN_REASON} characters: why this project needs it`,
    );
  }
  const question = [
    why,
    "",
    ISOLATION_PROTECTS,
    "",
    isolate ? `Isolate ${handle} in a worktree?` : `Return ${handle} to the working tree?`,
  ].join("\n");
  const options = isolate
    ? ["Yes, isolate it in a worktree", "No, keep it in the tree"]
    : ["Yes, back to the working tree", "No, keep it isolated"];
  return { question, options };
}

/* --------------------------------- footer -------------------------------- */

export const FOOTER_SEP = " · ";

/** Columns a code point occupies in a terminal: emoji and CJK are two. */
const WIDE_RANGES = [
  [0x1100, 0x115f],
  // Dingbats are text by default: `✓` is one cell, `✏️` is one plus the emoji
  // selector. The few that are emoji on their own are listed below.
  [0x2705, 0x2705],
  [0x2753, 0x2753],
  [0x2757, 0x2757],
  [0x2b50, 0x2b50],
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
    if (code === 0x200d) continue;
    // The emoji selector widens the glyph it follows, it does not add its own.
    if (code === 0xfe0f) {
      width += 1;
      continue;
    }
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

/* --------------------------------- panel --------------------------------- */

const RISK_WORD = { low: "low", medium: "med", high: "high" };

/**
 * `📋 #12 · panel de tarea · ready · med · evidence 2 · next: …`, or empty
 * without a task. The number is the human handle and the title the subject; the
 * machine id only shows up when a task predates numbering.
 */
export function panelRowTask(task) {
  if (!task?.id) return "";
  const number = Number(task.number);
  const handle = Number.isFinite(number) && number > 0 ? `#${number}` : oneLine(task.id, 32);
  const bits = [handle];
  const title = oneLine(String(task.title ?? "").toLowerCase(), 40);
  if (title) bits.push(title);
  bits.push(oneLine(task.phase, 12));
  const risk = RISK_WORD[task.risk] ?? oneLine(task.risk, 8);
  if (risk) bits.push(risk);
  const evidence = (Array.isArray(task.evidence) ? task.evidence : []).length;
  bits.push(`evidence ${evidence}`);
  if (task.next) bits.push(`next: ${oneLine(task.next, 56)}`);
  return `📋 ${bits.filter(Boolean).join(" · ")}`;
}

/** `🤖 worker 41s · 0.31cr     🤖 explorer 12s · 0.05cr`. */
export function panelRowChildren(children) {
  const parts = (Array.isArray(children) ? children : [])
    .filter((child) => child && child.role)
    .map((child) => {
      const elapsed = formatDuration(child.elapsedMs);
      const credits = Number.isFinite(Number(child.credits)) && Number(child.credits) > 0
        ? creditLabel(child.credits)
        : "·";
      return `🤖 ${oneLine(child.role, 16)} ${elapsed || "0s"} · ${credits}`;
    });
  return parts.join("     ");
}

/** `✓ 185/185 · review mwvis2b5 · 8 files uncommitted`. */
export function panelRowEvidence(state = {}) {
  const bits = [];
  const checks = state.checks;
  if (checks && Number(checks.total) > 0) {
    const failed = Number(checks.failed ?? 0);
    const total = Number(checks.total);
    const passed = Number.isFinite(Number(checks.passed)) ? Number(checks.passed) : total - failed;
    const mark = failed > 0 || checks.ok === false ? "✗" : "✓";
    bits.push(`${mark} ${passed}/${total}`);
  }
  // The meta id already carries the word (`review-mwvis2b5`): strip it, or the
  // row reads `review review-mwvi…`.
  if (state.review?.id) {
    bits.push(`review ${oneLine(String(state.review.id).replace(/^review-/, ""), 12)}`);
  }
  const dirty = Number(state.dirty) || 0;
  if (dirty > 0) bits.push(`${dirty} ${dirty === 1 ? "file" : "files"} uncommitted`);
  return bits.join(" · ");
}

/**
 * The panel rows, top to bottom: task, live children, evidence.
 *
 * No compression: a row that does not fit in `width` is hidden, not cut, so the
 * remaining rows keep their full meaning. `maxRows` caps the three.
 */
export function panelRows(state = {}, options = {}) {
  const width = Math.max(0, Math.trunc(Number(options.width) || 0));
  const maxRows = Math.max(0, Math.trunc(Number(options.maxRows ?? 3)));
  const rows = [
    panelRowTask(state.task),
    panelRowChildren(state.children),
    panelRowEvidence(state),
  ].filter(Boolean);
  const fits = width > 0 ? rows.filter((row) => textWidth(row) <= width) : rows;
  return fits.slice(0, maxRows);
}

/**
 * `auto` is the default and means "do not exist while everything is normal":
 * the panel shows up for an anomaly, not for company.
 */
export function shouldShowPanel(state = {}) {
  const mode = String(state.mode ?? "auto");
  if (mode === "off") return false;
  if (mode === "on") return true;
  return Boolean(
    (Array.isArray(state.children) && state.children.length > 0) ||
      state.lastCheckFailed ||
      state.pendingHighPlan ||
      (state.contextLevel && state.contextLevel !== "ok") ||
      state.reviewUncommitted ||
      Number(state.dirty) > 0,
  );
}
