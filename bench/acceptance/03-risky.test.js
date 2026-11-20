import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const pricing = await import(
  pathToFileURL(path.join(process.env.BENCH_WORKDIR, "src/pricing.js")).href
);

test("cartTotal reads the new unitPriceCents field", () => {
  assert.equal(
    pricing.cartTotal([
      { unitPriceCents: 250, quantity: 2 },
      { unitPriceCents: 100, quantity: 1 },
    ]),
    600,
  );
});

test("lineTotal keeps its positional contract", () => {
  assert.equal(pricing.lineTotal(250, 2), 500);
});
