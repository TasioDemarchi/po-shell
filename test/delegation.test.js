import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  checkPolicy,
  createTask,
  delegationMode,
  loadConfig,
  renderContext,
  renderStatus,
  updateTask,
} from "../src/kernel.js";

process.env.PO_SHELL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "po-shell-delegation-home-"));

function tempProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "po-shell-delegation-"));
  return dir;
}

test("the profile is data: default inline, configurable, and visible", () => {
  const dir = tempProject();
  const task = createTask(dir, { title: "perfil", risk: "low" });
  assert.equal(task.delegation, "inline");
  assert.equal(delegationMode(dir), "inline");

  updateTask(dir, task.id, { delegation: "delegate-writes" });
  assert.equal(delegationMode(dir), "delegate-writes");
  assert.match(renderStatus(dir), /Delegación: delegate-writes/);
  assert.match(renderContext(dir), /delegation: delegate-writes/);

  assert.throws(() => updateTask(dir, task.id, { delegation: "yolo" }), /delegation must be one of/);
});

test("the config can set the default profile for new tasks", () => {
  const dir = tempProject();
  createTask(dir, { title: "config", risk: "low" });
  const configPath = path.join(process.env.PO_SHELL_HOME, "projects", path.basename(dir), "config.json");
  assert.equal(fs.existsSync(configPath), false);
  const config = loadConfig(dir);
  assert.equal(config.delegation, "inline");
  assert.equal(config.reportMaxBytes, 16_384);
});

test("inline keeps the parent writing", () => {
  const dir = tempProject();
  createTask(dir, { title: "inline", risk: "low" });
  const verdict = checkPolicy(dir, "write", { path: "src/app.js", content: "x" });
  assert.equal(verdict.block, false);
});

test("delegate-writes blocks parent code writes but keeps docs, commits and checks", () => {
  const dir = tempProject();
  const task = createTask(dir, { title: "delegado", risk: "low", delegation: "delegate-writes" });
  assert.equal(task.delegation, "delegate-writes");

  const code = checkPolicy(dir, "write", { path: "src/app.js", content: "x" });
  assert.equal(code.block, true);
  assert.match(code.reason, /delegate-writes/);
  assert.match(code.reason, /role=worker/);

  const shellWrite = checkPolicy(dir, "bash", { command: "echo x > src/app.js" });
  assert.equal(shellWrite.block, true);
  assert.match(shellWrite.reason, /delegate-writes/);

  assert.equal(checkPolicy(dir, "write", { path: "docs/features/x.md", content: "# x" }).block, false);
  assert.equal(checkPolicy(dir, "bash", { command: "git commit -m state" }).block, false);
  assert.equal(checkPolicy(dir, "bash", { command: "npm test" }).block, false);
  assert.equal(checkPolicy(dir, "read", { path: "src/app.js" }).block, false);

  updateTask(dir, task.id, { delegation: "inline" });
  assert.equal(checkPolicy(dir, "write", { path: "src/app.js", content: "x" }).block, false);
});

test("the state files stay writable in both profiles", () => {
  const dir = tempProject();
  createTask(dir, { title: "estado", risk: "low", delegation: "delegate-writes" });
  const verdict = checkPolicy(dir, "write", {
    path: path.join(process.env.PO_SHELL_HOME, "projects", path.basename(dir), "notes.md"),
    content: "x",
  });
  assert.equal(verdict.block, false);
});

test("the plan summary is stored separately from the detailed plan", () => {
  const dir = tempProject();
  const task = createTask(dir, {
    title: "con resumen",
    risk: "high",
    plan: "1. Primero\n2. Segundo",
    planSummary: "  Dos pasos: primero y segundo.  ",
  });
  assert.equal(task.planSummary, "Dos pasos: primero y segundo.");
  assert.match(renderContext(dir), /plan_summary: Dos pasos: primero y segundo\./);

  const long = createTask(dir, { title: "largo", planSummary: "x".repeat(600) });
  assert.equal(long.planSummary.length, 400);
});
