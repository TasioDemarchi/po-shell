import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { branchName, createWorktree, removeWorktree, worktreeChanges, worktreePath } from "../src/worktree.js";

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "po-shell-wt-repo-"));
  const git = (...args) => {
    const proc = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    assert.equal(proc.status, 0, proc.stderr);
  };
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "test");
  fs.writeFileSync(path.join(dir, "a.txt"), "one\n");
  git("add", ".");
  git("commit", "-qm", "init");
  return dir;
}

function scratch() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "po-shell-wt-scratch-"));
}

test("branchName and worktreePath keep git and the filesystem happy", () => {
  assert.equal(branchName("run-mwv123"), "po-shell/run-mwv123");
  assert.equal(branchName("a b/c?"), "po-shell/a-b-c");
  assert.equal(branchName(""), "po-shell/child");
  assert.equal(worktreePath("/tmp/x", "run 1"), "/tmp/x/worktree-run-1");
});

test("the child works in its own worktree, not in the parent's", () => {
  const dir = repo();
  const box = scratch();
  const made = createWorktree(dir, { id: "run-1", dir: box });
  assert.equal(made.ok, true, made.error);
  assert.ok(made.path.startsWith(box));
  assert.ok(fs.existsSync(path.join(made.path, "a.txt")));

  fs.writeFileSync(path.join(made.path, "a.txt"), "one\ntwo\n");
  fs.writeFileSync(path.join(made.path, "b.txt"), "new\n");

  const changes = worktreeChanges(made.path);
  assert.equal(changes.ok, true);
  assert.equal(changes.files.length, 2, "tracked change plus untracked file");
  assert.ok(changes.stat.includes("a.txt"));
  assert.ok(changes.patch.includes("+two"));

  // The parent's tree never noticed.
  const parent = spawnSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8" });
  assert.equal(parent.stdout.trim(), "");

  const removed = removeWorktree(dir, made.path, { branch: made.branch });
  assert.equal(removed.ok, true, removed.error);
  assert.equal(fs.existsSync(made.path), false);
});

test("creating a worktree without scratch fails instead of guessing a path", () => {
  const result = createWorktree(repo(), { id: "run-2" });
  assert.equal(result.ok, false);
  assert.match(result.error, /scratch/);
});
