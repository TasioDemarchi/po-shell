import test from "node:test";
import assert from "node:assert/strict";
import { windowFrame } from "../src/window.js";

const texts = (rows) => rows.map((row) => row.text);

test("windowFrame draws a titled box around the body", () => {
  const rows = windowFrame({
    title: "plan",
    body: ["plan     6387.7cr left", "period   612.3cr"],
    hint: "esc close",
    width: 40,
  });
  assert.deepEqual(texts(rows), [
    `┌ plan ${"─".repeat(32)}┐`,
    `│ ${"plan     6387.7cr left".padEnd(36)} │`,
    `│ ${"period   612.3cr".padEnd(36)} │`,
    `│ ${" ".repeat(36)} │`,
    `│ ${"esc close".padEnd(36)} │`,
    `└${"─".repeat(38)}┘`,
  ]);
  assert.equal(new Set(rows.map((row) => row.text.length)).size, 1, "every row is one width");
  assert.equal(rows.at(-1).kind, "border");
  assert.equal(rows.at(-2).kind, "hint");
});

test("windowFrame never cuts the title, and grows for it", () => {
  const rows = windowFrame({ title: "subscriptions of nan", body: [], width: 10 });
  assert.ok(rows[0].text.includes("subscriptions of nan"));
  assert.ok(rows[0].text.startsWith("┌ subscriptions of nan "));
});

test("windowFrame truncates a long row instead of breaking the box", () => {
  const rows = windowFrame({ title: "usage", body: ["x".repeat(200)], width: 30 });
  for (const row of rows) assert.equal(row.text.length, 30);
  assert.ok(rows[1].text.includes("…"));
});

test("windowFrame without a title or hint still closes cleanly", () => {
  const rows = windowFrame({ body: ["a"], width: 20 });
  assert.equal(rows[0].text, "┌──────────────────┐");
  assert.equal(rows.at(-1).text, "└──────────────────┘");
  assert.equal(rows.length, 3);
  assert.deepEqual(windowFrame({}).length, 2);
});
