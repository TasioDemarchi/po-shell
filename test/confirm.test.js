import test from "node:test";
import assert from "node:assert/strict";
import { CONFIRM_ALLOW, CONFIRM_DENY, confirmDestructive, confirmTitle, previewCommand } from "../src/confirm.js";

const verdict = { key: "rmRecursive", targets: ["build/"] };

test("allows only an explicit allow answer", async () => {
  const ctx = { hasUI: true, ui: { select: async () => CONFIRM_ALLOW } };
  assert.equal(await confirmDestructive(ctx, verdict, { command: "rm -rf build/" }), true);

  const denied = { hasUI: true, ui: { select: async () => CONFIRM_DENY } };
  assert.equal(await confirmDestructive(denied, verdict, { command: "rm -rf build/" }), false);
});

test("fails closed without a usable UI", async () => {
  assert.equal(await confirmDestructive({ hasUI: false, ui: { select: async () => CONFIRM_ALLOW } }, verdict, {}), false);
  assert.equal(await confirmDestructive({ hasUI: true }, verdict, {}), false);
  assert.equal(await confirmDestructive({ hasUI: true, ui: { select: async () => "otra cosa" } }, verdict, {}), false);
  assert.equal(await confirmDestructive({ hasUI: true, ui: { select: async () => { throw new Error("cancelled"); } } }, verdict, {}), false);
  assert.equal(await confirmDestructive(undefined, verdict, {}), false);
});

test("the dialog shows the command and its targets", () => {
  const title = confirmTitle(verdict, { command: "rm -rf   build/" });
  assert.match(title, /rmRecursive/);
  assert.match(title, /build\//);
  assert.match(title, /rm -rf build\//);
});

test("previews are single-line and bounded", () => {
  assert.equal(previewCommand({ command: "  echo   hola  " }), "echo hola");
  assert.equal(previewCommand({ command: "x".repeat(400) }).length, 241);
  assert.equal(previewCommand({}), "");
});
