// A child that writes in a worktree of its own.
//
// The parent's tree is what the human believes they control; a child working
// directly in it mixes two histories in one `git status`. With isolation the
// child gets a branch and a directory outside the repo, the parent gets a diff it
// can read, and discarding the work is one command.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const ISOLATIONS = ["none", "worktree"];

function git(cwd, args, env = process.env) {
  const proc = spawnSync("git", args, { cwd, encoding: "utf8", env, timeout: 60_000 });
  return {
    ok: proc.status === 0,
    out: String(proc.stdout ?? "").trim(),
    err: String(proc.stderr ?? "").trim(),
  };
}

/** `run-mwv…` → `po-shell/run-mwv…`: a branch name git accepts. */
export function branchName(id) {
  const clean = String(id ?? "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `po-shell/${clean || "child"}`;
}

export function worktreePath(dir, id) {
  return path.join(String(dir ?? ""), `worktree-${String(id ?? "child").replace(/[^A-Za-z0-9._-]+/g, "-")}`);
}

/**
 * Create the child's worktree inside its scratch directory.
 * Returns `{ ok, path, branch, error }`; never throws.
 */
export function createWorktree(cwd, { id, dir, base = "HEAD", env = process.env } = {}) {
  if (!dir) return { ok: false, error: "worktree needs a scratch directory" };
  const target = worktreePath(dir, id);
  const branch = branchName(id);
  fs.mkdirSync(dir, { recursive: true });
  const added = git(cwd, ["worktree", "add", "-b", branch, target, base], env);
  if (!added.ok) {
    return { ok: false, path: target, branch, error: added.err || added.out || "git worktree add failed" };
  }
  return { ok: true, path: target, branch, error: "" };
}

/** Tracked changes plus untracked files, which is what a child actually leaves. */
export function worktreeChanges(worktree, env = process.env) {
  const status = git(worktree, ["status", "--porcelain"], env);
  const stat = git(worktree, ["diff", "--stat", "HEAD"], env);
  const patch = git(worktree, ["diff", "HEAD"], env);
  return {
    ok: status.ok && stat.ok,
    files: status.out ? status.out.split("\n").filter(Boolean) : [],
    stat: stat.out,
    patch: patch.out,
  };
}

/**
 * Remove a worktree and its branch. The human decides this: the parent reports
 * the path and the diff, and the cleanup happens when someone asks.
 */
export function removeWorktree(cwd, target, { branch = "", env = process.env } = {}) {
  const removed = git(cwd, ["worktree", "remove", "--force", target], env);
  if (branch) git(cwd, ["branch", "-D", branch], env);
  return { ok: removed.ok, error: removed.ok ? "" : removed.err || removed.out };
}
