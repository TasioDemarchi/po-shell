import test from "node:test";
import assert from "node:assert/strict";
import { cartTotal, formatMoney, lineTotal, parseQuantity } from "../src/pricing.js";

test("parses a valid quantity", () => {
  assert.equal(parseQuantity("3"), 3);
});

test("calculates a line total in cents", () => {
  assert.equal(lineTotal(250, 2), 500);
});

test("calculates a cart total in cents", () => {
  assert.equal(
    cartTotal([
      { priceCents: 250, quantity: 2 },
      { priceCents: 100, quantity: 1 },
    ]),
    600,
  );
});

test("formats cents as USD", () => {
  assert.equal(formatMoney(1234), "$12.34");
});
