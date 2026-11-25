// The `/stats` block: what the session cost, in tokens and credits, and where
// it went. Pure, so the numbers can be tested without a session. Chrome in
// English, task titles and paths as they are.

import { creditLabel } from "./minimal-ui.js";

const LABEL = 8;

function row(label, text) {
  return `${label.padEnd(LABEL)} ${text}`;
}

export function formatTokensShort(value) {
  const tokens = Number(value) || 0;
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return String(tokens);
}

/** `1h 42m`, `4m12s`, `38s`. */
export function formatSpan(ms) {
  const total = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}

/**
 * Turns, tool calls and failures out of Pi's session entries. A turn is an
 * assistant message; a tool call is a tool result, which is the only place that
 * knows whether it failed.
 */
export function sessionMetrics(entries) {
  const list = Array.isArray(entries) ? entries : [];
  let turns = 0;
  let toolCalls = 0;
  let failed = 0;
  let start = "";
  let end = "";
  for (const entry of list) {
    const at = String(entry?.timestamp ?? "");
    if (at) {
      if (!start || at < start) start = at;
      if (!end || at > end) end = at;
    }
    if (entry?.type !== "message") continue;
    const role = entry.message?.role;
    if (role === "assistant") turns += 1;
    if (role === "toolResult" || role === "tool") {
      toolCalls += 1;
      if (entry.message?.isError === true) failed += 1;
    }
  }
  const ms = start && end ? Math.max(0, Date.parse(end) - Date.parse(start)) : 0;
  return { ms, turns, toolCalls, failed };
}

function plural(count, word) {
  const value = Number(count) || 0;
  return `${value} ${word}${value === 1 ? "" : "s"}`;
}

/** Cache reads over everything the prompt was paid for, as a percentage. */
export function cacheHit(tokens = {}) {
  const cached = Number(tokens.cached) || 0;
  const input = Number(tokens.input) || 0;
  const total = cached + input;
  if (total <= 0) return null;
  return (cached / total) * 100;
}

function splitRoles(byRole) {
  const groups = Array.isArray(byRole) ? byRole : [];
  const orchestrator = groups.find((group) => group?.key === "orchestrator");
  const children = groups.filter((group) => group?.key !== "orchestrator");
  return {
    orchestrator: Number(orchestrator?.credits) || 0,
    subagents: children.reduce((sum, group) => sum + (Number(group?.credits) || 0), 0),
  };
}

/**
 * The block. `scope` names the first row: `session` for `/stats` in a session,
 * `project` for the CLI, where there is no session to measure.
 */
export function statsLines(state = {}) {
  const { scope = "session", session, cost, task, review, models = 4 } = state;
  const lines = [];

  if (session && (session.turns > 0 || session.ms > 0)) {
    const bits = [
      formatSpan(session.ms),
      plural(session.turns, "turn"),
      plural(session.toolCalls, "tool call"),
      `${Number(session.failed) || 0} failed`,
    ];
    lines.push(row(scope, bits.join(" · ")));
  }

  if (cost && Number(cost.events) > 0) {
    const roles = splitRoles(cost.byRole);
    const parts = [];
    if (roles.orchestrator > 0) parts.push(`orchestrator ${creditLabel(roles.orchestrator)}`);
    if (roles.subagents > 0) parts.push(`subagents ${creditLabel(roles.subagents)}`);
    const unpriced = Number(cost.unknownModels) > 0 ? ` · ${cost.unknownModels} unpriced` : "";
    lines.push(row("spent", `${creditLabel(cost.credits)}${parts.length ? `  (${parts.join(" · ")})` : ""}${unpriced}`));

    const tokens = cost.tokens ?? {};
    const hit = cacheHit(tokens);
    const tokenBits = [
      `in ${formatTokensShort(tokens.input)}`,
      `out ${formatTokensShort(tokens.output)}`,
      `cache R ${formatTokensShort(tokens.cached)}${hit === null ? "" : ` (${hit.toFixed(1)}% hit)`}`,
      `W ${formatTokensShort(tokens.cacheWrite)}`,
    ];
    lines.push(row("tokens", tokenBits.join(" · ")));

    const byModel = (cost.byModel ?? []).filter((group) => Number(group.events) > 0).slice(0, models);
    byModel.forEach((group, index) => {
      const used =
        (Number(group.tokens?.input) || 0) +
        (Number(group.tokens?.cached) || 0) +
        (Number(group.tokens?.output) || 0);
      const text = `${group.key}  ${plural(group.events, "turn")} · ${formatTokensShort(used)} · ${creditLabel(group.credits)}`;
      lines.push(row(index === 0 ? "models" : "", text));
    });
  }

  if (task) {
    const number = Number(task.number);
    const handle = Number.isFinite(number) && number > 0 ? `#${number}` : String(task.id);
    const bits = [handle, String(task.title ?? "").toLowerCase(), task.risk];
    const evidence = (Array.isArray(task.evidence) ? task.evidence : []).length;
    bits.push(`evidence ${evidence}`);
    if (review?.id) bits.push(`review ${String(review.id).replace(/^review-/, "")}`);
    lines.push(row("task", bits.filter(Boolean).join(" · ")));
  }

  return lines;
}
