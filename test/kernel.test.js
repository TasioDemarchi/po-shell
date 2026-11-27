import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  activeTask,
  activeTaskId,
  addDecision,
  attributableTask,
  checkPolicy,
  createTask,
  delegationMode,
  missionContextFiles,
  ensureTaskNumbers,
  freezeReview,
  getTask,
  init,
  isInitialized,
  knowledgeSince,
  latestReview,
  listTasks,
  memoryIndex,
  saveConfig,
  saveMemory,
  isolationCommand,
  renderContext,
  renderStatus,
  runChecks,
  setTaskIsolation,
  searchMemory,
  status,
  updateTask,
} from "../src/kernel.js";
import { poShellPath } from "../src/kernel.js";
import { evaluateToolCall } from "../src/policy.js";
import { DEFAULT_POLICY } from "../src/policy.js";
import { addDiscoveryBytes, bumpDiscovery, discoveryNote } from "../src/discovery.js";

process.env.PO_SHELL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "po-shell-home-"));

function featureDoc(dir, slug = "slice") {
  const file = path.join(dir, "docs", "features", `${slug}.md`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `---\ntype: feature\nstatus: active\n---\n\n# ${slug}\n`);
  return path.relative(dir, file);
}

function tempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "po-shell-test-"));
  return dir;
}

// Timestamps land in the same millisecond when a test runs fast, and both the
// discovery key and `knowledgeSince` compare instants: give them room.
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
  assert.ok(fs.existsSync(path.join(poShellPath(dir), "config.json")));
  assert.ok(fs.existsSync(path.join(poShellPath(dir), "tasks")));
  assert.ok(fs.existsSync(path.join(poShellPath(dir), "memory")));
  assert.ok(!fs.existsSync(path.join(dir, ".po-shell")));
});

test("migrates a legacy project .po-shell directory to central state", () => {
  const dir = tempRepo();
  const legacy = path.join(dir, ".po-shell");
  fs.mkdirSync(path.join(legacy, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(legacy, "config.json"), '{"version":1}\n');
  fs.writeFileSync(path.join(legacy, "tasks", "old.json"), '{}\n');

  const result = init(dir);
  assert.equal(result.migratedFrom, legacy);
  assert.ok(!fs.existsSync(legacy));
  assert.ok(fs.existsSync(path.join(poShellPath(dir), "config.json")));
  assert.ok(fs.existsSync(path.join(poShellPath(dir), "tasks", "old.json")));
});

test("init in the directory that holds the central home does not migrate it into itself", () => {
  const dir = tempRepo();
  const env = { ...process.env, PO_SHELL_HOME: path.join(dir, ".po-shell") };
  fs.mkdirSync(path.join(env.PO_SHELL_HOME, "projects"), { recursive: true });
  fs.writeFileSync(path.join(env.PO_SHELL_HOME, "context.db"), "");

  const result = init(dir, env);
  assert.equal(result.migratedFrom, null);
  assert.ok(fs.existsSync(path.join(env.PO_SHELL_HOME, "context.db")));
  assert.ok(fs.existsSync(path.join(poShellPath(dir, env), "config.json")));
});

test("tasks move through phases and stay active", () => {
  const dir = tempRepo();
  const doc = featureDoc(dir);
  const task = createTask(dir, { title: "Add retries", risk: "medium", scope: "upload", featureDoc: doc });
  assert.equal(activeTask(dir).id, task.id);
  const next = updateTask(dir, task.id, { phase: "implementing", next: "write test" });
  assert.equal(next.phase, "implementing");
  assert.equal(next.next, "write test");
  assert.equal(status(dir).activeTask.id, task.id);
});

test("high-risk tasks require explicit plan approval", () => {
  const dir = tempRepo();
  const doc = featureDoc(dir);
  const task = createTask(dir, { title: "Change public contract", risk: "high", featureDoc: doc });
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
  const file = fs.readFileSync(results[0].slug ? path.join(poShellPath(dir), "memory", `${results[0].slug}.md`) : "", "utf8");
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
  git(dir, ["config", "user.email", "po-shell@test.local"]);
  git(dir, ["config", "user.name", "po-shell Test"]);
  fs.writeFileSync(path.join(dir, "a.txt"), "one\n");
  git(dir, ["add", "."]);
  git(dir, ["commit", "-m", "init"]);
  init(dir);
  // The scaffold lands once and is committed: only the intended change is the candidate.
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-m", "scaffold"]);

  fs.writeFileSync(path.join(dir, "a.txt"), "one\ntwo\n");
  const meta = freezeReview(dir, { base: "HEAD" });
  assert.equal(meta.hash.length, 64);
  assert.equal(meta.added, 1);
  assert.equal(meta.files.includes("a.txt"), true);
  assert.equal(latestReview(dir).id, meta.id);
  const patch = fs.readFileSync(path.join(poShellPath(dir), "reviews", meta.id, "diff.patch"), "utf8");
  assert.match(patch, /\+two/);
});

test("review risk escalates when a task touches a sensitive path", () => {
  const dir = tempRepo();
  git(dir, ["init"]);
  git(dir, ["config", "user.email", "po-shell@test.local"]);
  git(dir, ["config", "user.name", "po-shell Test"]);
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
  git(dir, ["config", "user.email", "po-shell@test.local"]);
  git(dir, ["config", "user.name", "po-shell Test"]);
  fs.writeFileSync(path.join(dir, "a.txt"), "one\n");
  git(dir, ["add", "."]);
  git(dir, ["commit", "-m", "init"]);
  init(dir);
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-m", "scaffold"]);
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
    /passing po_shell_check/,
  );
});

test("ready rejects checks evidence older than the last move to implementing", () => {
  const dir = tempRepo();
  const task = createTask(dir, { title: "Ship", risk: "low" });
  const working = updateTask(dir, task.id, { phase: "implementing" });
  assert.ok(working.implementingAt, "entering implementing starts the clock");

  const stale = new Date(Date.parse(working.implementingAt) - 60_000).toISOString();
  assert.throws(
    () => updateTask(dir, task.id, { phase: "ready", evidence: [{ ts: stale, kind: "checks", ok: true }] }),
    /older than the last move to implementing/,
  );
});

test("a check after implementing reaches ready, and a legacy check does not", () => {
  const dir = tempRepo();
  const task = createTask(dir, { title: "Ship", risk: "low" });

  // Evidence without ever entering implementing cannot vouch for the work.
  const now = new Date().toISOString();
  assert.throws(
    () => updateTask(dir, task.id, { phase: "ready", evidence: [{ ts: now, kind: "checks", ok: true }] }),
    /never entered implementing/,
  );

  const working = updateTask(dir, task.id, { phase: "implementing" });
  const fresh = new Date(Date.parse(working.implementingAt) + 1000).toISOString();
  const ready = updateTask(dir, task.id, { phase: "ready", evidence: [{ ts: fresh, kind: "checks", ok: true }] });
  assert.equal(ready.phase, "ready");
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

test("cost attribution skips a task that is no longer in progress", () => {
  const dir = tempRepo();
  init(dir);
  const task = createTask(dir, { title: "en curso", risk: "low" });
  assert.equal(attributableTask(dir)?.id, task.id);

  const working = updateTask(dir, task.id, { phase: "implementing" });
  const fresh = new Date(Date.parse(working.implementingAt) + 1000).toISOString();
  updateTask(dir, task.id, { phase: "ready", evidence: [{ ts: fresh, kind: "checks", ok: true }] });
  assert.equal(attributableTask(dir), null);

  updateTask(dir, task.id, { phase: "implementing" });
  assert.equal(attributableTask(dir)?.id, task.id);

  const next = createTask(dir, { title: "otra", risk: "low" });
  assert.equal(attributableTask(dir)?.id, next.id);
});

test("a review of untracked files counts their lines and trips maxChangedLines", () => {
  const dir = tempRepo();
  git(dir, ["init"]);
  git(dir, ["config", "user.email", "test@example.test"]);
  git(dir, ["config", "user.name", "test"]);
  fs.writeFileSync(path.join(dir, "README.md"), "# repo\n");
  git(dir, ["add", "README.md"]);
  git(dir, ["commit", "-m", "init"]);

  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src", "new.js"), "const x = 1;\n".repeat(500));

  init(dir);
  saveConfig(dir, { policy: { ...DEFAULT_POLICY, maxChangedLines: 100 } });
  const meta = freezeReview(dir, { base: "HEAD" });

  assert.ok(meta.added >= 500, `added=${meta.added}`);
  assert.equal(meta.overLimit, true);
  assert.equal(meta.limit, 100);
});

test("tasks carry a human number that never gets reused", () => {
  const dir = tempRepo();
  init(dir);
  const first = createTask(dir, { title: "Uno", risk: "low" });
  const second = createTask(dir, { title: "Dos", risk: "low" });
  assert.equal(first.number, 1);
  assert.equal(second.number, 2);

  // Removing the newest task must not hand its number to the next one.
  fs.rmSync(path.join(poShellPath(dir), "tasks", `${second.id}.json`));
  const third = createTask(dir, { title: "Tres", risk: "low" });
  assert.equal(third.number, 3);
});

test("a task is addressable by number, by #number and by id", () => {
  const dir = tempRepo();
  init(dir);
  const task = createTask(dir, { title: "Buscame", risk: "low" });
  assert.equal(getTask(dir, task.id)?.id, task.id);
  assert.equal(getTask(dir, String(task.number))?.id, task.id);
  assert.equal(getTask(dir, `#${task.number}`)?.id, task.id);
  assert.equal(getTask(dir, "999"), null);

  const updated = updateTask(dir, `#${task.number}`, { phase: "implementing" });
  assert.equal(updated.id, task.id, "updating by number writes the same task");
});

test("naming a task by id moves the active pointer", () => {
  const dir = tempRepo();
  init(dir);
  const first = createTask(dir, { title: "Primera", risk: "low" });
  const second = createTask(dir, { title: "Segunda", risk: "low" });
  assert.equal(activeTaskId(dir), second.id, "creating a task makes it active");

  // The named task becomes the active one even though it is not the newest.
  updateTask(dir, `#${first.number}`, { phase: "implementing" });
  assert.equal(activeTaskId(dir), first.id, "the named task is the active one");

  // Evidence follows the pointer: it lands on the named task, not on the old one.
  const result = runChecks(dir, ["true"]);
  assert.equal(result.ok, true);
  assert.equal(getTask(dir, first.id).evidence.length, 1, "the check lands on the named task");
  assert.equal(getTask(dir, second.id).evidence.length, 0, "the previously active task takes nothing");

  // Naming the task that is already active changes nothing.
  updateTask(dir, first.id, { next: "sigo acá" });
  assert.equal(activeTaskId(dir), first.id);

  // Without an id the pointer stays where it is.
  updateTask(dir, undefined, { next: "sin mover el puntero" });
  assert.equal(activeTaskId(dir), first.id, "no id, no move");

  // An unknown id throws the same error as before and moves nothing.
  assert.throws(() => updateTask(dir, "#999", { next: "nadie" }), /no active task/);
  assert.equal(activeTaskId(dir), first.id);

  // A rejected patch leaves the pointer where it was: the update never landed.
  assert.throws(
    () => updateTask(dir, second.id, { phase: "ready" }),
    /passing po_shell_check/,
    "ready without passing evidence is rejected",
  );
  assert.equal(activeTaskId(dir), first.id, "a rejected patch does not move the pointer");
  assert.equal(getTask(dir, second.id).phase, "authorized", "and nothing was written");
});

test("runChecks returns the task the evidence landed on, or null", () => {
  const dir = tempRepo();
  init(dir);
  const unattributed = runChecks(dir, ["true"]);
  assert.equal(unattributed.task, null, "no task, no attribution");

  const task = createTask(dir, { title: "Chequeo", risk: "low" });
  updateTask(dir, task.id, { phase: "implementing" });
  const result = runChecks(dir, ["true"]);
  assert.deepEqual(result.task, {
    id: task.id,
    number: task.number,
    phase: "checking",
    title: "Chequeo",
  });
  assert.deepEqual(
    Object.keys(result.results[0]).sort(),
    ["command", "exitCode", "ms", "ok", "output"],
    "the evidence shape does not change",
  );
  assert.equal(getTask(dir, task.id).phase, "ready", "a passing check still moves the phase");
});

test("the status shows the other tasks in progress, ordered and capped at three", () => {
  const dir = tempRepo();
  init(dir);
  const active = createTask(dir, { title: "Activa", risk: "low" });
  updateTask(dir, active.id, { phase: "implementing" });
  assert.ok(!renderStatus(dir).includes("Otras en curso"), "the active task is not 'other'");
  assert.ok(!renderContext(dir).includes("other_in_progress"), "nothing to report, no line");

  const second = createTask(dir, { title: "Otra", risk: "low" });
  updateTask(dir, second.id, { phase: "implementing" });
  updateTask(dir, active.id, { next: "vuelvo a la activa" });
  const shown = renderStatus(dir);
  assert.match(shown, new RegExp(`Otras en curso: #${second.number} implementing`));
  assert.ok(
    shown.indexOf("Otras en curso:") < shown.indexOf("Checks:"),
    "the line sits with the task, before the checks",
  );
  assert.match(renderContext(dir), new RegExp(`other_in_progress: #${second.number} implementing`));

  // Five tasks in progress: the active one plus four others.
  const more = [];
  for (const title of ["Tres", "Cuatro", "Cinco", "Seis"]) {
    const task = createTask(dir, { title, risk: "low" });
    updateTask(dir, task.id, { phase: "implementing" });
    more.push(task);
  }
  updateTask(dir, active.id, { next: "sigo en la activa" });

  const line = (t) => `#${t.number} implementing`;
  const expected = [second, more[0], more[1]].map(line).join(" · ");
  const statusLine = renderStatus(dir).split("\n").find((l) => l.startsWith("Otras en curso:"));
  assert.equal(statusLine, `Otras en curso: ${expected}`, "ordered by number, capped at three");
  const contextLine = renderContext(dir).split("\n").find((l) => l.startsWith("other_in_progress:"));
  assert.equal(contextLine, `other_in_progress: ${expected}`);
});

test("tasks created before the number existed get one, once", () => {
  const dir = tempRepo();
  init(dir);
  const tasksDir = path.join(poShellPath(dir), "tasks");
  const legacy = {
    id: "vieja-abc123",
    title: "Vieja",
    phase: "ready",
    risk: "low",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    evidence: [],
  };
  fs.writeFileSync(path.join(tasksDir, `${legacy.id}.json`), JSON.stringify(legacy));

  // Listing is enough: the legacy task is numbered on the first read.
  assert.equal(listTasks(dir)[0].number, 1);
  const numbered = getTask(dir, legacy.id);
  assert.equal(numbered.number, 1);
  assert.equal(ensureTaskNumbers(dir), 0, "a second pass changes nothing");
  assert.equal(getTask(dir, "#1")?.id, legacy.id, "the backfilled number resolves");

  const fresh = createTask(dir, { title: "Nueva", risk: "low" });
  assert.equal(fresh.number, 2);
});

test("isolation is off by default and only the human's path can turn it on", () => {
  const dir = tempRepo();
  init(dir);
  const task = createTask(dir, { title: "Aislada", risk: "low" });
  assert.equal(task.isolation, "none");

  const isolated = setTaskIsolation(dir, task.id, "worktree");
  assert.equal(isolated.isolation, "worktree");
  assert.equal(getTask(dir, task.id).isolation, "worktree", "it persists");

  const back = setTaskIsolation(dir, `#${task.number}`, "none");
  assert.equal(back.isolation, "none");
  assert.throws(() => setTaskIsolation(dir, task.id, "sandbox"), /none, worktree/);
});

test("the isolation command names the task with the handle the human reads", () => {
  const dir = tempRepo();
  init(dir);
  const task = createTask(dir, { title: "Aislar esto", risk: "low" });
  assert.equal(isolationCommand(task), `po-shell task isolation worktree #${task.number}`);
  assert.equal(isolationCommand(task, "none"), `po-shell task isolation none #${task.number}`);

  setTaskIsolation(dir, task.id, "worktree");
  const rendered = renderStatus(dir);
  assert.match(rendered, /Aislamiento: worktree/);
  assert.ok(!renderStatus(tempRepoOfTask(dir, task)).includes("Aislamiento"), "sin aislamiento no se anuncia");
});

function tempRepoOfTask(dir, task) {
  const other = tempRepo();
  init(other);
  return other;
}

test("the profile follows the risk unless the human said otherwise", () => {
  const dir = tempRepo();
  init(dir);

  const low = createTask(dir, { title: "Bajo", risk: "low" });
  assert.equal(delegationMode(dir), "inline", "low risk edits in place");

  const medium = createTask(dir, { title: "Medio", risk: "medium" });
  assert.equal(delegationMode(dir), "delegate-writes", "medium and above go to a worker");

  assert.equal(delegationMode(dir, { ...process.env }), "delegate-writes");

  updateTask(dir, medium.id, { delegation: "inline" });
  assert.equal(delegationMode(dir), "inline", "an explicit task setting wins");

  saveConfig(dir, { delegation: "inline" });
  updateTask(dir, medium.id, { delegation: "delegate-writes" });
  assert.equal(delegationMode(dir), "delegate-writes", "task beats project");
  assert.ok(low);
});

test("a high-risk task cannot delegate before the plan is approved", () => {
  const dir = tempRepo();
  init(dir);
  const task = createTask(dir, { title: "Riesgo alto", risk: "high", plan: "1. tocar auth" });

  const blocked = checkPolicy(dir, "po_shell_delegate", {});
  assert.equal(blocked.block, true);
  assert.match(blocked.reason, /riesgo alto sin plan aprobado/);
  assert.match(blocked.reason, /action="approve"/);

  updateTask(dir, task.id, { phase: "planned" });
  assert.equal(checkPolicy(dir, "po_shell_delegate", {}).block, true, "still blocked while planned");

  updateTask(dir, task.id, { planApproved: true });
  assert.equal(checkPolicy(dir, "po_shell_delegate", {}).block ?? false, false, "approved, the door opens");
});

test("a medium-risk task delegates without any approval", () => {
  const dir = tempRepo();
  init(dir);
  const task = createTask(dir, { title: "Riesgo medio", risk: "medium", plan: "1. tocar el renderer" });
  assert.equal(task.planApproved, true, "medium is not a human decision");
  assert.equal(checkPolicy(dir, "po_shell_delegate", {}).block ?? false, false);
});

test("the orchestrator writes the project documents under delegate-writes", () => {
  const dir = tempRepo();
  init(dir);
  createTask(dir, { title: "Documentos", risk: "medium", delegation: "delegate-writes" });
  assert.equal(delegationMode(dir), "delegate-writes");

  const documents = [
    "PROJECT.md",
    "AGENTS.md",
    "README.md",
    "docs/features/anything.md",
    "docs/architecture.md",
    "prompts/subagents/explore.md",
  ];
  for (const file of documents) {
    assert.equal(
      checkPolicy(dir, "write", { path: file, content: "x" }).block ?? false,
      false,
      `write ${file}`,
    );
    assert.equal(
      checkPolicy(dir, "edit", { path: file, edits: [{ oldText: "a", newText: "b" }] }).block ?? false,
      false,
      `edit ${file}`,
    );
  }
});

test("prose is prose: docs/ and prompts/ are writable, every code path stays delegated", () => {
  const dir = tempRepo();
  init(dir);
  createTask(dir, { title: "Frontera", risk: "medium", delegation: "delegate-writes" });

  for (const file of ["docs/architecture.md", "prompts/subagents/explore.md"]) {
    assert.equal(checkPolicy(dir, "write", { path: file, content: "x" }).block ?? false, false, file);
    assert.equal(
      checkPolicy(dir, "bash", { command: `printf x > ${file}` }).block ?? false,
      false,
      `bash redirect to ${file}`,
    );
  }

  for (const file of ["src/foo.js", "extensions/po-shell.ts"]) {
    const verdict = checkPolicy(dir, "write", { path: file, content: "x" });
    assert.equal(verdict.block, true, `${file} is still code`);
    assert.match(verdict.reason, /delegate-writes/);
    assert.match(verdict.reason, /role=worker/);
    assert.ok(verdict.reason.includes(file), "the message names the file");
    assert.match(verdict.reason, /docs\//, "the message names docs/");
    assert.match(verdict.reason, /prompts\//, "the message names prompts/");
  }
});

test("the parent still delegates code and every other path in the repo", () => {
  const dir = tempRepo();
  init(dir);
  createTask(dir, { title: "Código", risk: "medium", delegation: "delegate-writes" });

  for (const file of ["src/kernel.js", "src/foo.js", "extensions/po-shell.ts", "package.json", "AGENTS.md.bak"]) {
    const verdict = checkPolicy(dir, "write", { path: file, content: "x" });
    assert.equal(verdict.block, true, `${file} stays delegated`);
    assert.match(verdict.reason, /delegate-writes/);
    assert.match(verdict.reason, /role=worker/);
    assert.ok(verdict.reason.includes(file), "the message names the file");
    assert.match(verdict.reason, /PROJECT\.md/, "the message names the documents the parent owns");
  }
});

test("a bash redirect follows the same surfaces as write and edit", () => {
  const dir = tempRepo();
  init(dir);
  createTask(dir, { title: "Shell", risk: "medium", delegation: "delegate-writes" });

  assert.equal(checkPolicy(dir, "bash", { command: "echo hola > PROJECT.md" }).block ?? false, false);
  assert.equal(checkPolicy(dir, "bash", { command: "printf x >> AGENTS.md" }).block ?? false, false);

  const code = checkPolicy(dir, "bash", { command: "echo hola > src/kernel.js" });
  assert.equal(code.block, true, "a redirect into code is still delegated");
  assert.match(code.reason, /delegate-writes/);
  assert.match(code.reason, /src\/kernel\.js/);

  const tee = checkPolicy(dir, "bash", { command: "echo hola | tee package.json" });
  assert.equal(tee.block, true, "tee into code is still delegated");
  assert.match(tee.reason, /package\.json/);
});

test("the inline profile allows the same writes it allowed before", () => {
  const dir = tempRepo();
  init(dir);
  createTask(dir, { title: "Inline", risk: "low", delegation: "inline" });
  assert.equal(delegationMode(dir), "inline");

  for (const file of [
    "PROJECT.md",
    "AGENTS.md",
    "README.md",
    "docs/features/anything.md",
    "src/kernel.js",
  ]) {
    assert.equal(checkPolicy(dir, "write", { path: file, content: "x" }).block ?? false, false, file);
  }
  assert.equal(checkPolicy(dir, "bash", { command: "echo x > src/kernel.js" }).block ?? false, false);
});

test("a medium task cannot implement without a feature doc", () => {
  const dir = tempRepo();
  const task = createTask(dir, { title: "Sin doc", risk: "medium" });
  assert.throws(() => updateTask(dir, task.id, { phase: "implementing" }), /needs `feature_doc`/);

  const missing = featureDoc(dir, "slice");
  fs.rmSync(path.join(dir, missing));
  assert.throws(
    () => updateTask(dir, task.id, { phase: "implementing", featureDoc: missing }),
    /does not exist/,
  );

  const real = featureDoc(dir, "real");
  assert.equal(updateTask(dir, task.id, { phase: "implementing", featureDoc: real }).phase, "implementing");
});

test("a low task never needs a feature doc", () => {
  const dir = tempRepo();
  const task = createTask(dir, { title: "Chico", risk: "low" });
  assert.equal(updateTask(dir, task.id, { phase: "implementing" }).phase, "implementing");
});

test("the mission reads the task's feature doc first, without the parent repeating it", () => {
  const dir = tempRepo();
  const doc = featureDoc(dir, "delegation");
  const task = createTask(dir, { title: "Con doc", risk: "medium", featureDoc: doc });
  assert.equal(activeTask(dir).id, task.id);

  assert.deepEqual(missionContextFiles(dir, ["AGENTS.md"]), [doc, "AGENTS.md"]);
  assert.deepEqual(missionContextFiles(dir, [doc, "AGENTS.md"]), [doc, "AGENTS.md"], "no duplicates");
  assert.deepEqual(missionContextFiles(dir, []), [doc]);

  createTask(dir, { title: "Otra sin doc", risk: "low" });
  assert.deepEqual(missionContextFiles(dir, ["AGENTS.md"]), ["AGENTS.md"], "the doc comes from the active task");
});

test("init scaffolds the two documents and never overwrites them", () => {
  const dir = tempRepo();
  init(dir);
  assert.ok(fs.existsSync(path.join(dir, "PROJECT.md")));
  assert.ok(fs.existsSync(path.join(dir, "AGENTS.md")));

  fs.writeFileSync(path.join(dir, "PROJECT.md"), "# propio\n");
  init(dir);
  assert.equal(fs.readFileSync(path.join(dir, "PROJECT.md"), "utf8"), "# propio\n");
});

test("the discovery counter shows from the third call and resets with implementing", async () => {
  const dir = tempRepo();
  init(dir);
  const task = createTask(dir, { title: "Descubrir", risk: "low" });
  const working = updateTask(dir, task.id, { phase: "implementing" });

  bumpDiscovery(dir, "read", working);
  bumpDiscovery(dir, "grep", working);
  assert.equal(discoveryNote(dir, working).count, 2);
  assert.equal(discoveryNote(dir, working).text, null, "two calls are not a nudge yet");
  assert.ok(!renderContext(dir).includes("discovery:"), "no line below the threshold");
  assert.ok(!renderStatus(dir).includes("Descubrimiento:"), "no line below the threshold");

  bumpDiscovery(dir, "ls", working);
  assert.equal(discoveryNote(dir, working).count, 3);
  assert.equal(
    discoveryNote(dir, working).text,
    "3 llamadas y 0 KB leídos sin delegar — el skill pide un explorer",
  );
  assert.match(renderContext(dir), /discovery: 3 calls · 0 KB · delegate an explorer/);
  const shown = renderStatus(dir).split("\n");
  const line = shown.find((l) => l.startsWith("Descubrimiento:"));
  assert.equal(line, "Descubrimiento: 3 llamadas y 0 KB leídos sin delegar — el skill pide un explorer");
  assert.ok(
    shown.indexOf(line) < shown.findIndex((l) => l.startsWith("Checks:")),
    "the line sits before the checks",
  );
  assert.ok(
    fs.existsSync(path.join(poShellPath(dir), "discovery.json")),
    "the counter lives in the central state",
  );
  assert.ok(!fs.existsSync(path.join(dir, "discovery.json")), "and never in the repo");

  // Outside implementing/checking the count is kept but nobody is nudged.
  const paused = updateTask(dir, task.id, { phase: "exploring" });
  assert.equal(discoveryNote(dir, paused).count, 3, "the count survives the pause");
  assert.equal(discoveryNote(dir, paused).text, null, "but the work is paused");
  assert.ok(!renderContext(dir).includes("discovery:"));
  assert.ok(!renderStatus(dir).includes("Descubrimiento:"));

  // A new move to implementing is a new clock: the count starts over at one.
  await sleep(5);
  const reentered = updateTask(dir, task.id, { phase: "implementing" });
  assert.notEqual(reentered.implementingAt, working.implementingAt);
  assert.deepEqual(discoveryNote(dir, reentered), { count: 0, bytes: 0, text: null });
  bumpDiscovery(dir, "read", reentered);
  assert.equal(discoveryNote(dir, reentered).count, 1, "the calls of the previous round are gone");
});

test("edits, writes and delegation do not count as discovery", () => {
  const dir = tempRepo();
  init(dir);
  const task = createTask(dir, { title: "No suma", risk: "low" });
  const working = updateTask(dir, task.id, { phase: "implementing" });

  for (const tool of ["edit", "write", "po_shell_delegate", "po_shell_task", "po_shell_check", "web_fetch"]) {
    assert.equal(bumpDiscovery(dir, tool, working), null, `${tool} is not discovery`);
  }
  assert.equal(discoveryNote(dir, working).count, 0);
  assert.equal(bumpDiscovery(dir, "read", null), null, "no task, nothing to attribute");
});

test("the discovery counter weighs bytes too, and resets both with the key", async () => {
  const dir = tempRepo();
  init(dir);
  const task = createTask(dir, { title: "Leer mucho", risk: "low" });

  // Round one: calls alone, almost no bytes.
  const working = updateTask(dir, task.id, { phase: "implementing" });
  bumpDiscovery(dir, "read", working);
  bumpDiscovery(dir, "grep", working);
  bumpDiscovery(dir, "find", working);
  const byCalls = discoveryNote(dir, working);
  assert.equal(byCalls.count, 3);
  assert.equal(byCalls.bytes, 0);
  assert.equal(byCalls.text, "3 llamadas y 0 KB leídos sin delegar — el skill pide un explorer");

  // Round two: a single 50 KB read trips the line by bytes alone.
  await sleep(5);
  updateTask(dir, task.id, { phase: "checking" });
  const heavy = updateTask(dir, task.id, { phase: "implementing" });
  const afterCall = bumpDiscovery(dir, "read", heavy);
  assert.deepEqual({ count: afterCall.count, bytes: afterCall.bytes }, { count: 1, bytes: 0 });
  const afterBytes = addDiscoveryBytes(dir, "read", heavy, 50 * 1024);
  assert.deepEqual(
    { count: afterBytes.count, bytes: afterBytes.bytes },
    { count: 1, bytes: 51_200 },
  );
  assert.equal(
    discoveryNote(dir, heavy).text,
    "1 llamadas y 50 KB leídos sin delegar — el skill pide un explorer",
    "both numbers show even when only the bytes trip",
  );
  const onDisk = JSON.parse(fs.readFileSync(path.join(poShellPath(dir), "discovery.json"), "utf8"));
  assert.equal(onDisk.count, 1);
  assert.equal(onDisk.bytes, 51_200, "the state carries the bytes next to the count");

  // Round three: both conditions, both numbers, and the previous round erased.
  await sleep(5);
  updateTask(dir, task.id, { phase: "checking" });
  const reentered = updateTask(dir, task.id, { phase: "implementing" });
  assert.deepEqual(discoveryNote(dir, reentered), { count: 0, bytes: 0, text: null });
  bumpDiscovery(dir, "read", reentered);
  bumpDiscovery(dir, "grep", reentered);
  bumpDiscovery(dir, "bash", reentered);
  addDiscoveryBytes(dir, "bash", reentered, 12 * 1024);
  assert.equal(
    discoveryNote(dir, reentered).text,
    "3 llamadas y 12 KB leídos sin delegar — el skill pide un explorer",
  );

  // A different task starts over, and only discovery tools add bytes.
  const other = createTask(dir, { title: "Otra", risk: "low" });
  assert.deepEqual(addDiscoveryBytes(dir, "read", other, 2048), {
    taskId: other.id,
    implementingAt: null,
    count: 0,
    bytes: 2048,
  });
  assert.equal(addDiscoveryBytes(dir, "edit", reentered, 5000), null, "edit is not discovery");
  assert.equal(addDiscoveryBytes(dir, "read", null, 5000), null, "no task, nothing to attribute");
});

test("knowledgeSince counts what was saved after implementing", async () => {
  const dir = tempRepo();
  init(dir);
  const task = createTask(dir, { title: "Conocimiento", risk: "low" });

  const zeros = { memories: 0, decisions: 0, total: 0 };
  assert.deepEqual(knowledgeSince(dir, null), zeros, "no task, no knowledge");
  assert.deepEqual(knowledgeSince(dir, task), zeros, "no implementingAt, no clock");

  const working = updateTask(dir, task.id, { phase: "implementing" });
  assert.deepEqual(knowledgeSince(dir, working), zeros, "nothing captured yet: the line would show");

  await sleep(5);
  saveMemory(dir, {
    title: "La causa era el hint del índice",
    what: "El hint apuntaba a la tabla vieja.",
    why: "La migración renombró la tabla.",
    learned: "Revisar el hint al migrar.",
  });
  const withMemory = knowledgeSince(dir, getTask(dir, task.id));
  assert.equal(withMemory.memories, 1);
  assert.equal(withMemory.decisions, 0);
  assert.equal(withMemory.total, 1, "with a memory the line has nothing to say");

  await sleep(5);
  addDecision(dir, { text: "el contrato público usa unitPriceCents" });
  const both = knowledgeSince(dir, getTask(dir, task.id));
  assert.equal(both.decisions, 1);
  assert.equal(both.memories, 1);
  assert.equal(both.total, 2);
});

test("knowledgeSince ignores the automatic state snapshot", async () => {
  const dir = tempRepo();
  init(dir);
  const task = createTask(dir, { title: "Snapshot", risk: "low" });
  const working = updateTask(dir, task.id, { phase: "implementing" });

  await sleep(5);
  // The snapshot the kernel writes on every phase change and every check:
  // same shape `snapshotTask` uses (type=state, topic=state/<task-id>).
  saveMemory(dir, {
    title: `Task state: ${working.id}`,
    what: `${working.title} · ${working.phase} · risk ${working.risk}`,
    why: "Automatic state snapshot for fast resume.",
    type: "state",
    scope: "project",
    topic: `state/${working.id}`,
    status: "active",
  });
  saveMemory(dir, {
    title: "Session snapshot",
    what: "Automatic session snapshot.",
    type: "session",
    scope: "project",
    topic: "session/current",
    status: "active",
  });

  const afterSnapshot = knowledgeSince(dir, getTask(dir, task.id));
  assert.equal(afterSnapshot.memories, 0, "the automatic snapshot is not knowledge");
  assert.equal(afterSnapshot.decisions, 0);
  assert.equal(afterSnapshot.total, 0, "0 since implementing: the line would show");

  await sleep(5);
  saveMemory(dir, {
    title: "La causa era el hint del índice",
    what: "El hint apuntaba a la tabla vieja.",
    learned: "Revisar el hint al migrar.",
    type: "lesson",
  });
  const withLesson = knowledgeSince(dir, getTask(dir, task.id));
  assert.equal(withLesson.memories, 1);
  assert.equal(withLesson.decisions, 0);
  assert.equal(withLesson.total, 1, "a lesson still counts");
});
