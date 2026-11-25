import test from "node:test";
import assert from "node:assert/strict";
import {
  cacheHit,
  formatSpan,
  formatTokensShort,
  sessionMetrics,
  statsLines,
} from "../src/stats.js";

test("formatTokensShort switches unit by magnitude", () => {
  assert.equal(formatTokensShort(850), "850");
  assert.equal(formatTokensShort(412_000), "412k");
  assert.equal(formatTokensShort(9_100_000), "9.1M");
  assert.equal(formatTokensShort(0), "0");
});

test("formatSpan reads like a clock", () => {
  assert.equal(formatSpan(38_000), "38s");
  assert.equal(formatSpan(252_000), "4m12s");
  assert.equal(formatSpan(6_120_000), "1h 42m");
  assert.equal(formatSpan(0), "0s");
});

test("sessionMetrics counts assistant turns and tool results", () => {
  const metrics = sessionMetrics([
    { type: "message", timestamp: "2026-11-25T10:00:00.000Z", message: { role: "user" } },
    { type: "message", timestamp: "2026-11-25T10:01:00.000Z", message: { role: "assistant" } },
    { type: "message", timestamp: "2026-11-25T10:01:10.000Z", message: { role: "toolResult" } },
    { type: "message", timestamp: "2026-11-25T10:01:20.000Z", message: { role: "toolResult", isError: true } },
    { type: "thinking_level_change", timestamp: "2026-11-25T10:02:00.000Z" },
  ]);
  assert.equal(metrics.turns, 1);
  assert.equal(metrics.toolCalls, 2);
  assert.equal(metrics.failed, 1);
  assert.equal(metrics.ms, 120_000);
  assert.deepEqual(sessionMetrics(undefined), { ms: 0, turns: 0, toolCalls: 0, failed: 0 });
});

test("cacheHit is the share of the prompt that was cached", () => {
  assert.equal(cacheHit({ input: 10, cached: 90 }), 90);
  assert.equal(cacheHit({ input: 0, cached: 0 }), null);
  assert.equal(cacheHit({}), null);
});

function cost() {
  return {
    events: 14,
    credits: 18.62,
    unknownModels: 0,
    tokens: { input: 412_000, cached: 9_100_000, output: 38_000, cacheWrite: 0 },
    byRole: [
      { key: "orchestrator", credits: 16.52 },
      { key: "worker", credits: 2.1 },
    ],
    byModel: [
      { key: "deepseek-v4-flash", events: 12, credits: 0.9, tokens: { input: 100_000, cached: 200_000, output: 20_000 } },
      { key: "deepseek-v4-pro", events: 2, credits: 15.6, tokens: { input: 130_000, cached: 0, output: 0 } },
    ],
  };
}

test("statsLines prints the block the doc describes", () => {
  const lines = statsLines({
    session: { ms: 6_120_000, turns: 14, toolCalls: 96, failed: 2 },
    cost: cost(),
    task: { id: "guard-abc", number: 12, title: "Guard de contexto", risk: "medium", evidence: [{}, {}] },
    review: { id: "review-mwvis2b5" },
  });
  assert.deepEqual(lines, [
    "session  1h 42m · 14 turns · 96 tool calls · 2 failed",
    "spent    18.6cr  (orchestrator 16.5cr · subagents 2.10cr)",
    "tokens   in 412k · out 38k · cache R 9.1M (95.7% hit) · W 0",
    "models   deepseek-v4-flash  12 turns · 320k · 0.90cr",
    "         deepseek-v4-pro  2 turns · 130k · 15.6cr",
    "task     #12 · guard de contexto · medium · evidence 2 · review mwvis2b5",
  ]);
});

test("statsLines degrades without a session, costs or task", () => {
  assert.deepEqual(statsLines({}), []);
  assert.deepEqual(statsLines({ cost: { events: 0 } }), []);
  assert.deepEqual(
    statsLines({ scope: "project", cost: { ...cost(), unknownModels: 2 }, models: 1 }),
    [
      "spent    18.6cr  (orchestrator 16.5cr · subagents 2.10cr) · 2 unpriced",
      "tokens   in 412k · out 38k · cache R 9.1M (95.7% hit) · W 0",
      "models   deepseek-v4-flash  12 turns · 320k · 0.90cr",
    ],
  );
});
