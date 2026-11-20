import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const pricing = await import(
  pathToFileURL(path.join(process.env.BENCH_WORKDIR, "src/pricing.js")).href
);

test("accepts a positive integer quantity", () => {
  assert.equal(pricing.parseQuantity("3"), 3);
});

test("rejects invalid quantities", () => {
  for (const value of ["0", "-1", "2.5", "abc", "", "Infinity"]) {
    assert.throws(() => pricing.parseQuantity(value), RangeError, value);
  }
});
