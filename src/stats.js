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
  if (tokens >= 1_000_000_000) return `${(tokens / 1_000_000_000).toFixed(2)}B`;
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

/** Days until the period renews, or null when the date is unusable. */
export function daysUntil(iso, now = new Date()) {
  const end = Date.parse(String(iso ?? ""));
  if (!Number.isFinite(end)) return null;
  const ms = end - new Date(now).getTime();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

/**
 * The subscription block: credits left, when they renew, what the billing period
 * spent and which model ate it. Model credits are a share of the period, so the
 * column adds up to 100 and reads as "who is paying for this".
 */
export function planLines(usage, options = {}) {
  if (!usage?.ok) {
    return [row("plan", `unavailable (${usage?.reason ?? "unknown"})`)];
  }
  const days = daysUntil(usage.periodEnd, options.now);
  const renews = days === null ? "" : ` · renews (${days}d)`;
  const frozen = usage.frozen ? " · frozen" : "";
  const pack = Number(usage.packCredits) > 0 ? ` · +${creditLabel(usage.packCredits)} pack` : "";
  const lines = [
    row("plan", `${creditLabel(usage.remaining)} left${renews}${pack}${frozen}`),
    row(
      "period",
      `${creditLabel(usage.used)} · ${Number(usage.requests) || 0} requests · ${formatTokensShort(usage.tokens)} tokens`,
    ),
  ];

  const models = Array.isArray(usage.byModel) ? usage.byModel : [];
  const limit = Math.max(1, Math.trunc(Number(options.models ?? 4)));
  const spent = models.reduce((sum, group) => sum + (Number(group.credits) || 0), 0);
  models.slice(0, limit).forEach((group, index) => {
    const share = spent > 0 ? ((Number(group.credits) || 0) / spent) * 100 : 0;
    const text = `${group.model}  ${share.toFixed(1)}% · ${formatTokensShort(group.tokens)} t · ${Number(group.requests) || 0} req`;
    lines.push(row(index === 0 ? "models" : "", text));
  });

  return lines;
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
 * The block. `scope` names the first row: `session` for `/usage` in a session,
 * `project` for the CLI, where there is no session to measure.
 *
 * No task row: the question this answers is "how much is this costing me", and
 * the task id, the risk and the review hash made the window three times wider
 * for something already on screen in the panel and in the footer.
 */
export function statsLines(state = {}) {
  const { scope = "session", session, cost, models = 4 } = state;
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

  return lines;
}
