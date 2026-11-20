import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_POLICY, evaluateToolCall, mutatingCommand } from "../src/policy.js";

test("detects mutating shell commands", () => {
  assert.equal(mutatingCommand("echo x > file.txt"), true);
  assert.equal(mutatingCommand("rm old.txt"), true);
  assert.equal(mutatingCommand("git commit -m x"), true);
  assert.equal(mutatingCommand("npm install"), true);
  assert.equal(mutatingCommand("sed -i 's/a/b/' file.txt"), true);
});

test("allows read-only shell commands", () => {
  assert.equal(mutatingCommand("grep hola README.md"), false);
  assert.equal(mutatingCommand("git status"), false);
  assert.equal(mutatingCommand("npm test"), false);
  assert.equal(mutatingCommand("ls -la"), false);
});


test("allows commits but blocks pushes by default", () => {
  const commit = evaluateToolCall({
    toolName: "bash",
    input: { command: "git commit -m state" },
    cwd: "/tmp/project",
    policy: DEFAULT_POLICY,
  });
  assert.equal(commit.block, false);

  const push = evaluateToolCall({
    toolName: "bash",
    input: { command: "git push origin main" },
    cwd: "/tmp/project",
    policy: DEFAULT_POLICY,
  });
  assert.equal(push.block, true);
  assert.match(push.reason, /allowPush/);
});
