import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { creditsFor, costSummary, formatCredits, recordCost } from "../src/costs.js";
import { projectIdentity } from "../src/project.js";
import { createTask, init } from "../src/kernel.js";
import { openContextDb } from "../src/indexer.js";

process.env.PO_SHELL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "po-shell-costs-home-"));

function tempProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "po-shell-costs-"));
}

function envFor(dir) {
  return {
    PO_SHELL_HOME: process.env.PO_SHELL_HOME,
    PO_SHELL_CONTEXT_DB: path.join(dir, "context.db"),
  };
}

test("creditsFor converts Nan token rates to credits", () => {
  const calc = creditsFor("nan/deepseek-v4-flash", {
    input: 1_000_000,
    cacheRead: 1_000_000,
    output: 1_000_000,
  });
  assert.equal(calc.known, true);
  assert.equal(calc.model, "deepseek-v4-flash");
  assert.ok(Math.abs(calc.credits - (10.5 + 0.21 + 42)) < 1e-9);
});

test("creditsFor counts cache writes for Kimi", () => {
  const calc = creditsFor("kimi-k3.1-pro", {
    input: 0,
    cacheRead: 0,
    output: 0,
    cacheWrite: 1_000_000,
  });
  assert.equal(calc.credits, 100);
});

test("creditsFor marks unknown models without inventing a cost", () => {
  const calc = creditsFor("model-without-rates", { input: 1_000_000, output: 1_000_000 });
  assert.equal(calc.known, false);
  assert.equal(calc.credits, 0);
});

test("recordCost persists events and costSummary groups them", () => {
  const dir = tempProject();
  const env = envFor(dir);
  init(dir, env);
  const task = createTask(dir, { title: "Cost ledger task", risk: "low" });

  recordCost(
    dir,
    {
      usage: { input: 100_000, cacheRead: 20_000, output: 10_000 },
      model: "nan/deepseek-v4-flash",
      role: "orchestrator",
      taskId: task.id,
      taskTitle: task.title,
    },
    { env },
  );
  recordCost(
    dir,
    {
      usage: { input: 50_000, cacheRead: 0, output: 5_000 },
      model: "glm5.3-flash",
      role: "explorer",
      source: "subagent",
      taskId: task.id,
      taskTitle: task.title,
    },
    { env },
  );

  const summary = costSummary({ env });
  assert.equal(summary.events, 2);
  assert.ok(summary.credits > 0);
  assert.equal(summary.byModel.length, 2);
  assert.equal(summary.byTask[0].key, task.id);
  assert.equal(summary.byRole.length, 2);

  const scoped = costSummary({ env, projectId: projectIdentity(dir).id });
  assert.equal(scoped.events, 2);

  const filtered = costSummary({ env, taskId: task.id, model: "glm5.3-flash" });
  assert.equal(filtered.events, 1);
  assert.equal(filtered.byModel[0].key, "glm5.3-flash");
});

test("formatCredits is stable", () => {
  assert.equal(formatCredits(0), "0");
  assert.equal(formatCredits(1.234), "1.23");
});

test("recordCost stores the session id and costSummary sums one session", () => {
  const dir = tempProject();
  const env = envFor(dir);
  init(dir, env);

  const first = recordCost(
    dir,
    {
      usage: { input: 1_000_000, cacheRead: 0, output: 0 },
      model: "nan/deepseek-v4-flash",
      role: "orchestrator",
      sessionId: "sess-a",
    },
    { env },
  );
  assert.equal(first.sessionId, "sess-a");

  recordCost(
    dir,
    {
      usage: { input: 0, cacheRead: 0, output: 1_000_000 },
      model: "nan/deepseek-v4-flash",
      role: "worker",
      source: "subagent",
      sessionId: "sess-a",
    },
    { env },
  );
  recordCost(
    dir,
    {
      usage: { input: 1_000_000, cacheRead: 0, output: 0 },
      model: "nan/deepseek-v4-flash",
      role: "orchestrator",
      sessionId: "sess-b",
    },
    { env },
  );

  const sessionA = costSummary({ env, sessionId: "sess-a" });
  assert.equal(sessionA.events, 2);
  assert.ok(Math.abs(sessionA.credits - (10.5 + 42)) < 1e-9);
  assert.deepEqual(sessionA.byRole.map((role) => role.key).sort(), ["orchestrator", "worker"]);
  const workerGroup = sessionA.byRole.find((role) => role.key === "worker");
  assert.ok(Math.abs(workerGroup.credits - 42) < 1e-9);

  const sessionB = costSummary({ env, sessionId: "sess-b" });
  assert.equal(sessionB.events, 1);
  assert.ok(Math.abs(sessionB.credits - 10.5) < 1e-9);

  assert.equal(costSummary({ env }).events, 3);
});

test("recordCost leaves the session empty when the caller has none", () => {
  const dir = tempProject();
  const env = envFor(dir);
  init(dir, env);
  const cost = recordCost(
    dir,
    { usage: { input: 1_000_000 }, model: "deepseek-v4-flash" },
    { env },
  );
  assert.equal(cost.sessionId, null);

  const db = openContextDb(path.join(dir, "context.db"));
  const row = db.prepare("SELECT session_id FROM cost_events ORDER BY id DESC LIMIT 1").get();
  assert.equal(row.session_id, null);
  db.close();
});
