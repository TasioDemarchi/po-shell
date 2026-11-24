import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  activeTask,
  addEvidence,
  appendEvent,
  checkPolicy,
  createTask,
  events,
  freezeReview,
  init,
  latestReview,
  loadConfig,
  renderContext,
  renderStatus,
  reviewDiff,
  runChecks,
  saveAgentArtifact,
  saveConfig,
  saveMemory,
  status,
  updateTask,
} from "../src/kernel.js";

const temp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

function withSentinelHome(run) {
  const sentinel = temp("po-shell-sentinel-");
  const previous = {
    home: process.env.PO_SHELL_HOME,
    db: process.env.PO_SHELL_CONTEXT_DB,
  };
  process.env.PO_SHELL_HOME = sentinel;
  process.env.PO_SHELL_CONTEXT_DB = path.join(sentinel, "context.db");
  try {
    run();
    assert.deepEqual(fs.readdirSync(sentinel), [], "the process home must stay untouched");
  } finally {
    if (previous.home === undefined) delete process.env.PO_SHELL_HOME;
    else process.env.PO_SHELL_HOME = previous.home;
    if (previous.db === undefined) delete process.env.PO_SHELL_CONTEXT_DB;
    else process.env.PO_SHELL_CONTEXT_DB = previous.db;
  }
}

function envFor(home) {
  return { PO_SHELL_HOME: home, PO_SHELL_CONTEXT_DB: path.join(home, "context.db") };
}

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

test("an explicit env never writes to the process home", () => {
  withSentinelHome(() => {
    const home = temp("po-shell-env-home-");
    const project = temp("po-shell-env-project-");
    const env = envFor(home);

    const initialized = init(project, env);
    assert.ok(initialized.root.startsWith(path.join(home, "projects")));

    const task = createTask(project, { title: "Tarea con env", risk: "medium" }, env);
    updateTask(project, task.id, { next: "seguir" }, env);
    addEvidence(project, { kind: "checks", ok: true }, env);
    appendEvent(project, "custom.event", {}, env);

    assert.ok(events(project, 10, env).some((event) => event.type === "custom.event"));
    assert.ok(fs.existsSync(path.join(initialized.root, "config.json")));
    assert.equal(loadConfig(project, env).version, 1);
    saveConfig(project, { checks: ["true"] }, env);
    assert.deepEqual(loadConfig(project, env).checks, ["true"]);
    assert.equal(activeTask(project, env).id, task.id);

    saveMemory(project, { title: "Memoria", what: "con env", scope: "project" }, env);
    assert.ok(fs.existsSync(path.join(home, "projects", path.basename(initialized.root), "memory")));

    assert.equal(runChecks(project, ["true"], env).ok, true);
    saveAgentArtifact(project, { id: "sub-1", output: "ok" }, env);
    assert.equal(checkPolicy(project, "read", { path: "a.txt" }, env).block, false);

    assert.equal(status(project, { env }).initialized, true);
    assert.match(renderStatus(project, env), /po-shell/);
    assert.match(renderContext(project, env), /<po_shell_state>/);

    assert.ok(fs.existsSync(path.join(home, "projects")));
  });
});

test("review paths honor an explicit env", () => {
  withSentinelHome(() => {
    const home = temp("po-shell-review-home-");
    const project = temp("po-shell-review-project-");
    const env = envFor(home);

    git(project, ["init", "-q"]);
    git(project, ["config", "user.email", "test@example.com"]);
    git(project, ["config", "user.name", "test"]);
    fs.writeFileSync(path.join(project, "app.js"), "export const a = 1;\n");
    git(project, ["add", "."]);
    git(project, ["commit", "-qm", "base"]);
    fs.writeFileSync(path.join(project, "app.js"), "export const a = 2;\n");

    const meta = freezeReview(project, { base: "HEAD" }, env);
    assert.equal(latestReview(project, env).id, meta.id);
    assert.equal(reviewDiff(project, null, env).meta.hash, meta.hash);
  });
});
