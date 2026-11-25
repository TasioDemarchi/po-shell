import test from "node:test";
import assert from "node:assert/strict";
import { fetchUsage, parseUsage, usageUrl } from "../src/nan-usage.js";

const payload = {
  credits: {
    period_start: "2026-11-13T20:50:03Z",
    period_end: "2026-12-13T20:50:03Z",
    allowance: 7000,
    used: 610.6,
    remaining: 6389.4,
    pack_credits: 0,
    pack_expires_at: null,
    frozen: false,
  },
  totals: {
    total_tokens: 1479772424,
    api_requests: 5831,
    credits: 610.8,
    by_model: [
      { model: "glm5.3-flash", credits: 10.7, total_tokens: 263913639, api_requests: 4107 },
      { model: "deepseek-v4-flash", credits: 460.7, total_tokens: 1148528426, api_requests: 10872 },
    ],
  },
};

function fakeFetch(handler) {
  const calls = [];
  const impl = async (url) => {
    calls.push(String(url));
    const body = handler(String(url));
    if (body instanceof Error) throw body;
    return { ok: body.status === undefined || body.status === 200, status: body.status ?? 200, json: async () => body.json };
  };
  impl.calls = calls;
  return impl;
}

const credentials = { NAN_API_KEY: "test-key", PI_CODING_AGENT_DIR: "/nonexistent" };

test("usageUrl builds the range only when it has one", () => {
  assert.equal(usageUrl("https://api.nan.builders/v1/"), "https://api.nan.builders/v1/usage");
  assert.equal(
    usageUrl("https://api.nan.builders/v1", { start: "2026-11-13", end: "2026-11-25" }),
    "https://api.nan.builders/v1/usage?start_date=2026-11-13&end_date=2026-11-25",
  );
});

test("parseUsage reads the plan, the period totals and the models by credits", () => {
  const usage = parseUsage(payload);
  assert.equal(usage.allowance, 7000);
  assert.equal(usage.used, 610.6);
  assert.equal(usage.remaining, 6389.4);
  assert.equal(usage.frozen, false);
  assert.equal(usage.periodEnd, "2026-12-13T20:50:03Z");
  assert.equal(usage.requests, 5831);
  assert.deepEqual(
    usage.byModel.map((entry) => entry.model),
    ["deepseek-v4-flash", "glm5.3-flash"],
    "bigger spender first",
  );
  assert.equal(usage.byModel[0].credits, 460.7);
});

test("parseUsage falls back to allowance minus used without `remaining`", () => {
  const usage = parseUsage({ credits: { allowance: 100, used: 25 }, totals: {} });
  assert.equal(usage.remaining, 75);
  assert.deepEqual(usage.byModel, []);
});

test("fetchUsage asks for the period, not for the last 30 days", async () => {
  const fetchImpl = fakeFetch(() => ({ json: payload }));
  const usage = await fetchUsage({ env: credentials, fetchImpl, now: new Date("2026-11-25T12:00:00Z") });
  assert.equal(usage.ok, true);
  assert.equal(fetchImpl.calls.length, 2);
  assert.ok(fetchImpl.calls[0].endsWith("/usage"));
  assert.ok(fetchImpl.calls[1].includes("start_date=2026-11-13"));
  assert.ok(fetchImpl.calls[1].includes("end_date=2026-11-25"));
  assert.equal(usage.periodStart, "2026-11-13");
});

test("fetchUsage degrades instead of throwing", async () => {
  const noKey = await fetchUsage({ env: { PI_CODING_AGENT_DIR: "/nonexistent" }, fetchImpl: fakeFetch(() => ({ json: payload })) });
  assert.deepEqual(noKey, { ok: false, reason: "no Nan credentials" });

  const rejected = await fetchUsage({
    env: credentials,
    fetchImpl: fakeFetch(() => ({ status: 401, json: {} })),
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.reason, "key rejected");

  const offline = await fetchUsage({
    env: credentials,
    fetchImpl: fakeFetch(() => new Error("fetch failed")),
  });
  assert.equal(offline.ok, false);
  assert.equal(offline.reason, "fetch failed");
});
