import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const pricing = await import(
  pathToFileURL(path.join(process.env.BENCH_WORKDIR, "src/pricing.js")).href
);

test("applies a percentage discount with half-up rounding", () => {
  assert.equal(pricing.applyDiscount(1000, 10), 900);
  assert.equal(pricing.applyDiscount(995, 10), 896);
  assert.equal(pricing.applyDiscount(1000, 0), 1000);
  assert.equal(pricing.applyDiscount(1000, 100), 0);
});

test("rejects invalid discount percentages", () => {
  for (const value of [-1, 101, NaN, Infinity]) {
    assert.throws(() => pricing.applyDiscount(1000, value), RangeError);
  }
});

test("cartTotal applies the discount to the subtotal", () => {
  const items = [
    { priceCents: 500, quantity: 2 },
    { priceCents: 1000, quantity: 1 },
  ];
  assert.equal(pricing.cartTotal(items, { discountPercent: 10 }), 1800);
  assert.equal(pricing.cartTotal(items), 2000);
});
