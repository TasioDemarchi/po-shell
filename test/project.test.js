import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { init } from "../src/kernel.js";
import { listProjectStates, projectIdentity, projectInfo, pruneProjectStates } from "../src/project.js";

process.env.PO_SHELL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "po-shell-project-home-"));

test("projectInfo resolves the central state and metadata", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "po-shell-project-"));
  init(dir);
  const info = projectInfo(dir);
  assert.equal(info.initialized, true);
  assert.equal(info.root, dir);
  assert.ok(info.stateDir.startsWith(process.env.PO_SHELL_HOME));
  assert.ok(fs.existsSync(path.join(info.stateDir, "project.json")));
  assert.equal(info.contextDb, path.join(process.env.PO_SHELL_HOME, "context.db"));
  assert.ok(!fs.existsSync(path.join(dir, ".po-shell")));
});

test("listProjectStates hides stale directories unless --all is requested", () => {
  const orphan = path.join(process.env.PO_SHELL_HOME, "projects", "orphan-no-meta");
  fs.mkdirSync(orphan, { recursive: true });
  const visible = listProjectStates(process.env);
  assert.ok(!visible.some((item) => item.id === "orphan-no-meta"));
  const all = listProjectStates(process.env, { all: true });
  assert.ok(all.some((item) => item.id === "orphan-no-meta"));
});

test("listProjectStates lists central projects by name", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "po-shell-project-list-"));
  init(dir);
  const projects = listProjectStates(process.env);
  const current = projects.find((item) => item.root === dir);
  assert.ok(current);
  assert.equal(current.initialized, true);
});


test("prunes orphan state directories into a backup", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "po-shell-project-prune-"));
  init(dir);
  const orphan = path.join(process.env.PO_SHELL_HOME, "projects", "orphan-prune");
  fs.mkdirSync(orphan, { recursive: true });
  fs.writeFileSync(path.join(orphan, "config.json"), "{}");

  const dry = pruneProjectStates(process.env, { dryRun: true });
  assert.ok(dry.candidates.some((item) => item.id === "orphan-prune"));
  assert.ok(fs.existsSync(orphan));

  const result = pruneProjectStates(process.env, { dryRun: false });
  assert.ok(result.moved.some((item) => item.id === "orphan-prune"));
  assert.ok(!fs.existsSync(orphan));
  assert.ok(result.trashDir && fs.existsSync(result.trashDir));
  assert.ok(listProjectStates(process.env).some((item) => item.root === dir));
});


test("projectInfo resolves the project root from a subdirectory", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "po-shell-project-root-"));
  fs.writeFileSync(path.join(dir, "PROJECT.md"), "# Project\n");
  init(dir);
  const sub = path.join(dir, "src", "nested");
  fs.mkdirSync(sub, { recursive: true });
  assert.equal(projectIdentity(sub).root, dir);
  assert.equal(projectInfo(sub).root, dir);
  assert.equal(projectInfo(sub).initialized, true);
});
