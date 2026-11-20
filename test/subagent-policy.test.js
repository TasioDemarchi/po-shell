import test from "node:test";
import assert from "node:assert/strict";
import { subagentToolBlock } from "../src/subagent-policy.js";

test("blocks Plain orchestrator tools", () => {
  assert.ok(subagentToolBlock("plain_memory", {}));
  assert.ok(subagentToolBlock("plain_task", {}));
  assert.equal(subagentToolBlock("read", { path: "README.md" }), null);
});

test("blocks Markdown and Plain state writes", () => {
  assert.ok(subagentToolBlock("write", { path: "README.md" }));
  assert.ok(subagentToolBlock("edit", { path: "docs/design.MD" }));
  assert.ok(subagentToolBlock("write", { path: ".plain/tasks/x.json" }));
  assert.equal(subagentToolBlock("write", { path: "src/app.js" }), null);
});

test("blocks shell writes to Markdown and Plain state", () => {
  assert.ok(subagentToolBlock("bash", { command: "echo hola >> README.md" }));
  assert.ok(subagentToolBlock("bash", { command: "sed -i 's/a/b/' docs/design.md" }));
  assert.ok(subagentToolBlock("bash", { command: "echo x > .plain/events.jsonl" }));
  assert.equal(subagentToolBlock("bash", { command: "grep hola README.md" }), null);
});
