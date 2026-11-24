import test from "node:test";
import assert from "node:assert/strict";
import { subagentToolBlock } from "../src/subagent-policy.js";

test("blocks po-shell orchestrator tools", () => {
  assert.ok(subagentToolBlock("po_shell_memory", {}));
  assert.ok(subagentToolBlock("po_shell_task", {}));
  assert.equal(subagentToolBlock("read", { path: "README.md" }), null);
});

test("blocks Markdown and po-shell state writes", () => {
  assert.ok(subagentToolBlock("write", { path: "README.md" }));
  assert.ok(subagentToolBlock("edit", { path: "docs/design.MD" }));
  assert.ok(subagentToolBlock("write", { path: ".po-shell/tasks/x.json" }));
  assert.equal(subagentToolBlock("write", { path: "src/app.js" }), null);
});

test("blocks shell writes to Markdown and po-shell state", () => {
  assert.ok(subagentToolBlock("bash", { command: "echo hola >> README.md" }));
  assert.ok(subagentToolBlock("bash", { command: "sed -i 's/a/b/' docs/design.md" }));
  assert.ok(subagentToolBlock("bash", { command: "echo x > .po-shell/events.jsonl" }));
  assert.equal(subagentToolBlock("bash", { command: "grep hola README.md" }), null);
});

test("blocks destructive shell commands in children, confirmed or not", () => {
  assert.match(subagentToolBlock("bash", { command: "rm -rf /" }), /destructivos/);
  assert.match(subagentToolBlock("bash", { command: "rm -rf build/" }), /destructivos/);
  assert.match(subagentToolBlock("bash", { command: 'sh -c "git reset --hard"' }), /destructivos/);
  assert.equal(subagentToolBlock("bash", { command: "rm build/tmp.txt" }), null);
  assert.equal(subagentToolBlock("bash", { command: "git status" }), null);
});
