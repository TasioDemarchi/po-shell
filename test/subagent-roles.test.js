import test from "node:test";
import assert from "node:assert/strict";
import {
  ROLE_RULES,
  SUBAGENT_ROLES,
  isSubagentRole,
  roleAllows,
  roleBudgets,
  roleRules,
  roleTools,
  validateMission,
  withinPrefixes,
} from "../src/subagent-roles.js";

test("three roles, each with a distinct capability set", () => {
  assert.deepEqual(SUBAGENT_ROLES, ["explorer", "worker", "reviewer"]);
  assert.equal(isSubagentRole("worker"), true);
  assert.equal(isSubagentRole("planner"), false, "planner is gone on purpose");
  assert.equal(roleRules("WORKER"), ROLE_RULES.worker, "roles are case-insensitive");
});

test("an unknown role throws instead of falling back to worker", () => {
  assert.throws(() => roleRules("planner"), /unknown subagent role/);
  assert.throws(() => roleRules(""), /unknown subagent role/);
  assert.throws(() => roleTools("planner"), /unknown subagent role/);
});

test("tools come from the role, and asking for a foreign tool is an error", () => {
  assert.deepEqual(roleTools("explorer"), ["read", "grep", "find", "ls"]);
  assert.deepEqual(roleTools("reviewer"), ["read", "grep", "find", "ls", "bash"]);
  assert.ok(roleTools("worker").includes("edit"));

  assert.throws(() => roleTools("explorer", ["read", "edit"]), /explorer cannot use edit/);
  assert.throws(() => roleTools("reviewer", ["bash", "write"]), /reviewer cannot use write/);
  assert.deepEqual(roleTools("worker", ["read", "read"]), ["read"], "duplicates collapse");
  assert.deepEqual(roleTools("worker", []), ROLE_RULES.worker.tools, "empty means the role default");
});

test("capabilities: writing is worker-only, web is explorer-only", () => {
  assert.equal(roleAllows("worker", "write"), true);
  assert.equal(roleAllows("explorer", "write"), false);
  assert.equal(roleAllows("reviewer", "write"), false);
  assert.equal(roleAllows("explorer", "web"), true);
  assert.equal(roleAllows("worker", "web"), false);
  assert.equal(roleAllows("worker", "bash"), true);
  assert.equal(roleAllows("explorer", "bash"), false);
  assert.equal(roleAllows("reviewer", "bash"), true, "the reviewer runs its own verification");
});

test("budgets default to the role and never exceed its ceiling", () => {
  assert.deepEqual(roleBudgets("explorer"), { maxTurns: 16, maxTokens: 0, timeoutSeconds: 420 });
  assert.deepEqual(roleBudgets("worker", { maxTurns: 25 }), { maxTurns: 25, maxTokens: 0, timeoutSeconds: 900 });
  assert.equal(roleBudgets("worker", { maxTurns: 500 }).maxTurns, 40, "the role owns the ceiling");
  assert.equal(roleBudgets("worker", { timeoutSeconds: 7200 }).timeoutSeconds, 900);
  assert.equal(roleBudgets("reviewer", { maxTokens: 20000 }).maxTokens, 20000);
});

test("withinPrefixes matches the prefix itself and below it, never a sibling", () => {
  assert.equal(withinPrefixes("/home/dev/gentle-shell", ["/home/dev/gentle-shell"]), true);
  assert.equal(withinPrefixes("/home/dev/gentle-shell/lib/a.ts", ["/home/dev/gentle-shell"]), true);
  assert.equal(withinPrefixes("/home/dev/gentle-shell-extra/a.ts", ["/home/dev/gentle-shell"]), false);
  assert.equal(withinPrefixes("/home/dev/x", []), false);
  assert.equal(withinPrefixes("/home/dev/x", [""]), false);
});

const workerMission = {
  role: "worker",
  task: "Give the rows a two-line frame",
  done: ["the frame closes at the same width"],
  buildTest: "npm test",
  surfaces: ["src/a.js"],
};

test("a worker mission needs done, build_test and surfaces", () => {
  assert.equal(validateMission(workerMission).ok, true);
  assert.match(validateMission({ ...workerMission, done: [] }).errors[0], /needs `done`/);
  assert.match(validateMission({ ...workerMission, buildTest: "  " }).errors[0], /needs `build_test`/);
  assert.match(validateMission({ ...workerMission, surfaces: [] }).errors[0], /needs `surfaces`/);
});

test("every role declares what finished looks like", () => {
  assert.match(validateMission({ role: "explorer", task: "Map the upload flow" }).errors[0], /an explorer needs `done`/);
  assert.equal(validateMission({ role: "explorer", task: "Map the upload flow", done: ["path:line evidence"] }).ok, true);
  assert.match(
    validateMission({ role: "reviewer", task: "Verify the frame change", done: ["verdict per item"] }).errors[0],
    /needs `build_test`/,
  );
  assert.equal(
    validateMission({ role: "reviewer", task: "Verify the frame change", done: ["verdict per item"], buildTest: "npm test" }).ok,
    true,
  );
});

test("the contract refuses contradictions instead of ignoring them", () => {
  assert.match(
    validateMission({ ...workerMission, readOutside: ["/home/dev/other"] }).errors[0],
    /only an explorer reads outside the repo/,
  );
  assert.match(
    validateMission({ role: "explorer", task: "Map the upload flow", done: ["x"], surfaces: ["src/a.js"] }).errors[0],
    /does not write, so `surfaces` makes no sense/,
  );
  assert.match(validateMission({ ...workerMission, task: "short" }).errors[0], /at least 10 characters/);
  assert.match(validateMission({ ...workerMission, role: "planner" }).errors[0], /unknown subagent role/);
});

test("one delegation returns every problem at once, not the first", () => {
  const result = validateMission({ role: "worker", task: "short" });
  assert.equal(result.ok, false);
  assert.ok(result.errors.length >= 4, `expected several errors, got ${result.errors.join(" | ")}`);
});
