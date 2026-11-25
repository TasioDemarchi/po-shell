// Context pressure for the orchestrator.
//
// The window is the only honest denominator: 15% of a 1M model is 157k tokens,
// 15% of a 200k model is 30k. Everything here is pure so the numbers can be
// tested without a session.

export const DEFAULT_CONTEXT_GUARD = {
  warnAt: 0.15,
  delegateAt: 0.3,
  enforce: false,
};

/** Prompt size of the last request: input + cached reads + cache writes. */
export function promptTokens(usage) {
  const input = Number(usage?.input) || 0;
  const cached = Number(usage?.cacheRead ?? usage?.cached) || 0;
  const written = Number(usage?.cacheWrite) || 0;
  return input + cached + written;
}

/**
 * { tokens, window, ratio } or null when the window is unknown: a ratio without
 * a denominator would be a guess, and a guess must not move a gate.
 */
export function contextPressure({ tokens, window } = {}) {
  const used = Number(tokens) || 0;
  const size = Number(window) || 0;
  if (used <= 0 || size <= 0) return null;
  return { tokens: used, window: size, ratio: Math.min(1, used / size) };
}

export function guardLevel(ratio, guard = DEFAULT_CONTEXT_GUARD) {
  if (!Number.isFinite(ratio) || ratio <= 0) return "ok";
  const delegateAt = Number(guard?.delegateAt ?? DEFAULT_CONTEXT_GUARD.delegateAt);
  const warnAt = Number(guard?.warnAt ?? DEFAULT_CONTEXT_GUARD.warnAt);
  if (ratio >= delegateAt) return "delegate";
  if (ratio >= warnAt) return "warn";
  return "ok";
}

export function formatTokens(value) {
  const tokens = Number(value) || 0;
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(tokens);
}

/** One line for the state block: `context: 5.4% (56.8k/1.0M)`. */
export function formatPressure(pressure) {
  if (!pressure) return null;
  const percent = (pressure.ratio * 100).toFixed(1);
  return `${percent}% (${formatTokens(pressure.tokens)}/${formatTokens(pressure.window)})`;
}

/** Model-facing line: what to do at this level, or nothing while there is room. */
export function contextDirective(level) {
  if (level === "warn") {
    return "context_rule: delegá el trabajo mecánico y no leas archivos enteros; el contexto ya pesa.";
  }
  if (level === "delegate") {
    return "context_rule: el contexto pasó el umbral de delegación; la implementación va a un worker.";
  }
  return null;
}
