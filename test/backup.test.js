import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  checkIntegrity,
  createBackup,
  fixIntegrity,
  listBackups,
  restoreBackup,
} from "../src/backup.js";
import { openContextDb } from "../src/indexer.js";
import { createTask, init, saveMemory } from "../src/kernel.js";

process.env.PLAIN_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "plain-backup-home-"));

function tempProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "plain-backup-"));
}

function envFor(dir) {
  return {
    PLAIN_HOME: process.env.PLAIN_HOME,
    PLAIN_CONTEXT_DB: path.join(dir, "context.db"),
  };
}

function setup() {
  const dir = tempProject();
  const env = envFor(dir);
  init(dir, env);
  const task = createTask(dir, { title: "Backup task", risk: "low" });
  saveMemory(
    dir,
    {
      title: "Recovery lesson",
      what: "Backups include state and SQLite.",
      topic: "lesson/backup",
      type: "lesson",
    },
    env,
  );
  return { dir, env, task };
}

test("creates a backup with state, DB snapshot and manifest", () => {
  const { dir, env } = setup();
  const result = createBackup(dir, { env });
  assert.equal(result.ok, true);
  assert.ok(fs.existsSync(path.join(result.path, "manifest.json")));
  assert.ok(fs.existsSync(path.join(result.path, "state", "config.json")));
  assert.ok(fs.existsSync(path.join(result.path, "context.db")));
  assert.equal(result.manifest.version, 1);
  assert.ok(result.manifest.db.files.includes("context.db"));
});

test("lists backups for a project", () => {
  const { dir, env } = setup();
  createBackup(dir, { env });
  const backups = listBackups(env);
  assert.ok(backups.length >= 1);
  assert.equal(backups[0].manifest.project.id, resultProjectId(env, dir));
});

function resultProjectId(env, dir) {
  return createBackup(dir, { env }).manifest.project.id;
}

test("restores project state and moves the previous state to trash", () => {
  const { dir, env, task } = setup();
  const backup = createBackup(dir, { env });
  const taskFile = path.join(process.env.PLAIN_HOME, "projects", backup.manifest.project.id, "tasks", `${task.id}.json`);
  fs.rmSync(taskFile);
  fs.rmSync(env.PLAIN_CONTEXT_DB);
  assert.ok(!fs.existsSync(taskFile));

  const restored = restoreBackup(dir, backup.path, { env, yes: true });
  assert.ok(fs.existsSync(taskFile));
  assert.ok(fs.existsSync(env.PLAIN_CONTEXT_DB));
  assert.equal(checkIntegrity(dir, { env }).ok, true);
  assert.ok(fs.existsSync(restored.trashDir));
});

test("integrity reports a healthy project and repairs missing memory rows", () => {
  const { dir, env } = setup();
  const healthy = checkIntegrity(dir, { env });
  assert.equal(healthy.ok, true);
  assert.equal(healthy.errors, 0);

  const projectId = path.basename(checkIntegrity(dir, { env }).project.stateDir);
  const db = openContextDb(env.PLAIN_CONTEXT_DB);
  db.prepare("DELETE FROM memories WHERE project_id = ?").run(projectId);
  db.close();

  const broken = checkIntegrity(dir, { env });
  assert.ok(broken.warnings >= 1);

  const fixed = fixIntegrity(dir, { env });
  assert.equal(fixed.integrity.ok, true);
  assert.equal(fixed.integrity.warnings, 0);
});

test("restore refuses to run without --yes", () => {
  const { dir, env } = setup();
  const backup = createBackup(dir, { env });
  assert.throws(() => restoreBackup(dir, backup.path, { env }), /requires --yes/);
});
