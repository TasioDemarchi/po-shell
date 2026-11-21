import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  activeTask,
  createTask,
  freezeReview,
  init,
  isInitialized,
  latestReview,
  memoryIndex,
  saveMemory,
  searchMemory,
  status,
  updateTask,
} from "../src/kernel.js";
import { plainPath } from "../src/kernel.js";
import { evaluateToolCall } from "../src/policy.js";
import { DEFAULT_POLICY } from "../src/policy.js";

process.env.PLAIN_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "plain-home-"));

function tempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plain-test-"));
  return dir;
}

function git(dir, args) {
  const proc = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  assert.equal(proc.status, 0, proc.stderr);
  return proc.stdout;
}

test("init creates the state directory and config", () => {
  const dir = tempRepo();
  assert.equal(isInitialized(dir), false);
  init(dir);
  assert.equal(isInitialized(dir), true);
  assert.ok(fs.existsSync(path.join(plainPath(dir), "config.json")));
  assert.ok(fs.existsSync(path.join(plainPath(dir), "tasks")));
  assert.ok(fs.existsSync(path.join(plainPath(dir), "memory")));
  assert.ok(!fs.existsSync(path.join(dir, ".plain")));
});

test("migrates a legacy project .plain directory to central state", () => {
  const dir = tempRepo();
  const legacy = path.join(dir, ".plain");
  fs.mkdirSync(path.join(legacy, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(legacy, "config.json"), '{"version":1}\n');
  fs.writeFileSync(path.join(legacy, "tasks", "old.json"), '{}\n');

  const result = init(dir);
  assert.equal(result.migratedFrom, legacy);
  assert.ok(!fs.existsSync(legacy));
  assert.ok(fs.existsSync(path.join(plainPath(dir), "config.json")));
  assert.ok(fs.existsSync(path.join(plainPath(dir), "tasks", "old.json")));
});

test("tasks move through phases and stay active", () => {
  const dir = tempRepo();
  const task = createTask(dir, { title: "Add retries", risk: "medium", scope: "upload" });
  assert.equal(activeTask(dir).id, task.id);
  const next = updateTask(dir, task.id, { phase: "implementing", next: "write test" });
  assert.equal(next.phase, "implementing");
  assert.equal(next.next, "write test");
  assert.equal(status(dir).activeTask.id, task.id);
});

test("high-risk tasks require explicit plan approval", () => {
  const dir = tempRepo();
  const task = createTask(dir, { title: "Change public contract", risk: "high" });
  assert.equal(task.planApproved, false);
  assert.throws(
    () => updateTask(dir, task.id, { phase: "implementing" }),
    /plan approval/,
  );
  const approved = updateTask(dir, task.id, { planApproved: true, phase: "planned" });
  assert.equal(approved.planApproved, true);
  assert.equal(updateTask(dir, task.id, { phase: "implementing" }).phase, "implementing");
});

test("memory saves and searches with a useful snippet", () => {
  const dir = tempRepo();
  saveMemory(dir, {
    title: "Idempotency key",
    what: "Reuse request id for uploads.",
    why: "Retries duplicated records.",
    where: "internal/upload/handler.go",
    learned: "The request id is stable across retries.",
    topic: "architecture/uploads",
  });
  const results = searchMemory(dir, "duplicated records");
  assert.ok(results.length >= 1);
  assert.equal(results[0].slug, "architecture-uploads");
  assert.match(results[0].snippet, /Retries duplicated records/i);
  const index = memoryIndex(dir);
  assert.equal(index.length, 1);
  assert.equal(index[0].slug, "architecture-uploads");
});

test("SQLite is canonical after deleting the Markdown mirror", () => {
  const dir = tempRepo();
  init(dir);
  const saved = saveMemory(dir, {
    title: "Durable upload rule",
    what: "Reuse the request id.",
    why: "Retries duplicated records.",
    learned: "The id is stable.",
  });
  fs.rmSync(saved.file);
  const results = searchMemory(dir, "durable upload rule");
  assert.equal(results.length, 1);
  assert.equal(memoryIndex(dir)[0].slug, "durable-upload-rule");
});

test("memory aliases make bilingual exact searches work", () => {
  const dir = tempRepo();
  saveMemory(dir, {
    title: "Upload idempotency",
    what: "Reuse the request id for uploads.",
    why: "Retries duplicated records.",
    where: "internal/upload/handler.go",
    learned: "The request id is stable across retries.",
    aliases: "idempotencia, reintentos, request id",
  });
  const results = searchMemory(dir, "idempotencia");
  assert.ok(results.length >= 1);
  assert.equal(results[0].slug, "upload-idempotency");
  const file = fs.readFileSync(results[0].slug ? path.join(plainPath(dir), "memory", `${results[0].slug}.md`) : "", "utf8");
  assert.match(file, /- aliases: idempotencia, reintentos, request id/);
});

test("memory derives a title from what when title is missing", () => {
  const dir = tempRepo();
  const saved = saveMemory(dir, {
    what: "El contrato público usa unitPriceCents.",
    why: "Se renombró priceCents.",
    type: "decision",
  });
  assert.equal(saved.slug, "el-contrato-publico-usa-unitpricecents");
  assert.match(fs.readFileSync(saved.file, "utf8"), /# El contrato público usa unitPriceCents/);
  assert.throws(() => saveMemory(dir, { why: "sin título ni what" }), /title is required/);
});

test("policy denies secrets and dangerous commands", () => {
  const denied = evaluateToolCall({
    toolName: "write",
    input: { path: ".env" },
    cwd: "/tmp/project",
    policy: DEFAULT_POLICY,
    activeTask: { id: "t" },
  });
  assert.equal(denied.block, true);

  const danger = evaluateToolCall({
    toolName: "bash",
    input: { command: "sudo rm -rf /" },
    cwd: "/tmp/project",
    policy: DEFAULT_POLICY,
    activeTask: { id: "t" },
  });
  assert.equal(danger.block, true);

  const ok = evaluateToolCall({
    toolName: "bash",
    input: { command: "npm test" },
    cwd: "/tmp/project",
    policy: DEFAULT_POLICY,
    activeTask: { id: "t" },
  });
  assert.equal(ok.block, false);
});

test("freezeReview captures a stable hash of a real diff", () => {
  const dir = tempRepo();
  git(dir, ["init"]);
  git(dir, ["config", "user.email", "plain@test.local"]);
  git(dir, ["config", "user.name", "Plain Test"]);
  fs.writeFileSync(path.join(dir, "a.txt"), "one\n");
  git(dir, ["add", "."]);
  git(dir, ["commit", "-m", "init"]);
  init(dir);

  fs.writeFileSync(path.join(dir, "a.txt"), "one\ntwo\n");
  const meta = freezeReview(dir, { base: "HEAD" });
  assert.equal(meta.hash.length, 64);
  assert.equal(meta.added, 1);
  assert.equal(meta.files.includes("a.txt"), true);
  assert.equal(latestReview(dir).id, meta.id);
  const patch = fs.readFileSync(path.join(plainPath(dir), "reviews", meta.id, "diff.patch"), "utf8");
  assert.match(patch, /\+two/);
});

test("review risk escalates when a task touches a sensitive path", () => {
  const dir = tempRepo();
  git(dir, ["init"]);
  git(dir, ["config", "user.email", "plain@test.local"]);
  git(dir, ["config", "user.name", "Plain Test"]);
  fs.mkdirSync(path.join(dir, "auth"), { recursive: true });
  fs.writeFileSync(path.join(dir, "auth", "login.js"), "old\n");
  git(dir, ["add", "."]);
  git(dir, ["commit", "-m", "init"]);
  createTask(dir, { title: "Adjust login", risk: "medium" });
  fs.writeFileSync(path.join(dir, "auth", "login.js"), "new\n");
  const meta = freezeReview(dir, { base: "HEAD" });
  assert.equal(meta.risk, "high");
});

test("freezeReview refuses an empty candidate", () => {
  const dir = tempRepo();
  git(dir, ["init"]);
  git(dir, ["config", "user.email", "plain@test.local"]);
  git(dir, ["config", "user.name", "Plain Test"]);
  fs.writeFileSync(path.join(dir, "a.txt"), "one\n");
  git(dir, ["add", "."]);
  git(dir, ["commit", "-m", "init"]);
  init(dir);
  assert.throws(() => freezeReview(dir), /no changes/);
});


test("createTask stores the plan and updateTask preserves it", () => {
  const dir = tempRepo();
  const task = createTask(dir, {
    title: "Plan task",
    risk: "high",
    plan: "1. Migrar\n2. Validar\n3. Rollback",
  });
  assert.match(task.plan, /Migrar/);
  const updated = updateTask(dir, task.id, { next: "revisar plan" });
  assert.match(updated.plan, /Rollback/);
  assert.equal(updated.next, "revisar plan");
});

test("updateTask keeps fields that are omitted", () => {
  const dir = tempRepo();
  const task = createTask(dir, { title: "Preserve fields", risk: "medium", scope: "old" });
  const updated = updateTask(dir, task.id, {
    phase: undefined,
    risk: undefined,
    scope: "new",
    next: undefined,
  });
  assert.equal(updated.phase, "authorized");
  assert.equal(updated.risk, "medium");
  assert.equal(updated.title, "Preserve fields");
  assert.equal(updated.scope, "new");
});

test("ready requires passing check evidence", () => {
  const dir = tempRepo();
  const task = createTask(dir, { title: "Ship", risk: "low" });
  assert.throws(
    () => updateTask(dir, task.id, { phase: "ready" }),
    /passing plain_check/,
  );
});


test("high-risk delivery requires a frozen review", () => {
  const dir = tempRepo();
  const task = createTask(dir, { title: "Risky ship", risk: "high" });
  updateTask(dir, task.id, { planApproved: true, phase: "planned" });
  assert.throws(
    () => updateTask(dir, task.id, { phase: "delivered" }),
    /frozen review/,
  );
});
