import test from "node:test";
import assert from "node:assert/strict";
import { memoryAction, taskAction } from "../src/tool-defaults.js";

test("po_shell_task infers new when action is missing", () => {
  assert.equal(taskAction({ title: "Add retries" }), "new");
  assert.equal(taskAction({ phase: "implementing" }), "phase");
  assert.equal(taskAction({}), "show");
  assert.equal(taskAction({ action: "list", title: "x" }), "list");
});

test("po_shell_memory infers search or save", () => {
  assert.equal(memoryAction({ query: "retries" }), "search");
  assert.equal(memoryAction({ title: "Retries" }), "save");
  assert.equal(memoryAction({ action: "search", title: "x" }), "search");
});
