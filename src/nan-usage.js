// The subscription, not the session: what Nan says about the credits left, when
// they renew and which model ate the billing period.
//
// One undocumented endpoint does all of it (`GET /v1/usage`); everything else
// under /v1 answers 404. So this module is best-effort by design: a failure
// returns `{ ok: false, reason }` and the caller says so in one line instead of
// pretending the numbers are there.

import { nanProvider } from "./semantic.js";

export const USAGE_TIMEOUT_MS = 3000;

function isoDay(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

export function usageUrl(baseUrl, { start, end } = {}) {
  const base = String(baseUrl ?? "").replace(/\/$/, "");
  const url = new URL(`${base}/usage`);
  if (start) url.searchParams.set("start_date", start);
  if (end) url.searchParams.set("end_date", end);
  return url.toString();
}

export function parseUsage(payload) {
  const credits = payload?.credits ?? {};
  const totals = payload?.totals ?? {};
  const allowance = Number(credits.allowance) || 0;
  const used = Number(credits.used) || 0;
  const remainingRaw = Number(credits.remaining);
  const byModel = (Array.isArray(totals.by_model) ? totals.by_model : [])
    .map((entry) => ({
      model: String(entry?.model ?? ""),
      credits: Number(entry?.credits) || 0,
      tokens: Number(entry?.total_tokens) || 0,
      requests: Number(entry?.api_requests) || 0,
    }))
    .filter((entry) => entry.model)
    .sort((a, b) => b.credits - a.credits);

  return {
    allowance,
    used,
    remaining: Number.isFinite(remainingRaw) ? remainingRaw : Math.max(0, allowance - used),
    frozen: credits.frozen === true,
    packCredits: Number(credits.pack_credits) || 0,
    packExpiresAt: credits.pack_expires_at ?? null,
    periodStart: String(credits.period_start ?? ""),
    periodEnd: String(credits.period_end ?? ""),
    tokens: Number(totals.total_tokens) || 0,
    requests: Number(totals.api_requests) || 0,
    byModel,
  };
}

async function getJson(url, apiKey, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(USAGE_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

/**
 * Two calls on purpose: the first one tells when the billing period started,
 * the second asks for the models inside that window. Model credits over the last
 * 30 days would not add up to `used`, and two numbers that disagree read as a bug.
 */
export async function fetchUsage({ env = process.env, fetchImpl = fetch, now = new Date() } = {}) {
  const provider = nanProvider(env);
  if (!provider?.apiKey) return { ok: false, reason: "no Nan credentials" };
  const baseUrl = provider.baseUrl || "https://api.nan.builders/v1";
  try {
    const head = parseUsage(await getJson(usageUrl(baseUrl), provider.apiKey, fetchImpl));
    const start = isoDay(head.periodStart);
    const end = isoDay(now);
    if (!start) return { ok: true, ...head, periodTokens: head.tokens, periodRequests: head.requests };
    const period = parseUsage(await getJson(usageUrl(baseUrl, { start, end }), provider.apiKey, fetchImpl));
    return { ...head, ok: true, periodStart: start, periodEnd: head.periodEnd || end, used: period.used || head.used, tokens: period.tokens, requests: period.requests, byModel: period.byModel };
  } catch (error) {
    const message = String(error?.message ?? error);
    const reason = /HTTP 401|HTTP 403/.test(message) ? "key rejected" : message.includes("timeout") ? "timeout" : message;
    return { ok: false, reason };
  }
}
