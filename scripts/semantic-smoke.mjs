import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { searchContext } from "../src/context.js";
import { init, saveMemory } from "../src/kernel.js";
import { semanticConfig } from "../src/semantic.js";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "plain-semantic-smoke-"));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plain-semantic-project-"));
const env = {
  ...process.env,
  PLAIN_HOME: home,
  PLAIN_CONTEXT_DB: path.join(home, "context.db"),
  PLAIN_SEMANTIC: "on",
};

if (!semanticConfig(env)) {
  console.error("semantic smoke: no Nan credentials; skipping");
  process.exit(0);
}

init(dir, env);
saveMemory(
  dir,
  {
    title: "Cache invalidation on profile updates",
    what: "Invalidate the profile cache after an update.",
    why: "Users saw stale profile data.",
    learned: "Cache keys are scoped by user id.",
    topic: "lesson/profile-cache",
    type: "lesson",
  },
  env,
);
saveMemory(
  dir,
  {
    title: "Coupon expiry timezone bug",
    what: "A coupon stayed active because the expiry was compared in the wrong timezone.",
    why: "UTC was compared with local time.",
    learned: "Normalize expiry to UTC and test the 23:59 boundary.",
    topic: "lesson/coupon-expiry",
    type: "lesson",
  },
  env,
);
saveMemory(
  dir,
  {
    title: "Discount rounding rule",
    what: "Round discounts down to the nearest cent.",
    why: "Avoid over-discounting.",
    learned: "Use floor and test percentage coupons.",
    topic: "lesson/discount-rounding",
    type: "lesson",
  },
  env,
);

const cases = [
  ["datos viejos del perfil", "mem:lesson-profile-cache"],
  ["cupones que ya vencieron", "mem:lesson-coupon-expiry"],
  ["cómo redondeamos los descuentos", "mem:lesson-discount-rounding"],
];

for (const [query, expected] of cases) {
  const result = await searchContext(dir, query, {
    env,
    kinds: ["memory"],
    limit: 5,
    semantic: true,
  });
  const ids = result.results.map((item) => item.id);
  assert.ok(ids.includes(expected), `${query} did not find ${expected}`);
  console.log(`ok: ${query} -> ${expected}`);
}

console.log("semantic smoke: 3/3");
