import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  appendJsonl,
  ensureDir,
  nowIso,
  readJson,
  readJsonl,
  sha256,
  slugify,
  tail,
  writeJson,
} from "./util.js";
import { DEFAULT_POLICY, evaluateToolCall, deniedCommand, deniedPath } from "./policy.js";
import { shellWriteTargets, withinSurfaces } from "./subagent-policy.js";
import {
  appendDecision,
  decisionByPrefix,
  docPath,
  nextDecisionId,
  orphanDecisions,
  readDoc,
} from "./decisions.js";
import { ensureProjectDocs } from "./scaffold.js";
import {
  DEFAULT_CONTEXT_GUARD,
  contextDirective,
  contextPressure,
  formatPressure,
  guardLevel,
  promptTokens,
} from "./context-guard.js";
import { GLOBAL_PROJECT_ID, contextDbPath, openContextDb } from "./indexer.js";
import { costSummary, formatCredits } from "./costs.js";
import {
  legacyStateDir,
  poShellHome,
  projectIdentity,
  projectMetaPath,
  projectStateDir,
} from "./project.js";
export const PHASES = [
  "authorized",
  "exploring",
  "planned",
  "implementing",
  "checking",
  "ready",
  "delivered",
  "blocked",
];
export const RISKS = ["low", "medium", "high"];

// What the orchestrator may do itself. `delegate-writes` keeps decisions,
// exploration, the feature doc and commits, and hands every code mutation to a
// bounded child. It is data, not prompt text: the tool gate enforces it.
export const DELEGATIONS = ["inline", "delegate-writes"];

const DEFAULT_CONFIG = {
  version: 1,
  checks: [],
  policy: DEFAULT_POLICY,
  maxChangedLines: 400,
  models: {},
  delegation: "auto",
  reportMaxBytes: 16_384,
  // The window is the denominator, so the same fractions work for 200k and 1M.
  contextGuard: DEFAULT_CONTEXT_GUARD,
};

export function poShellPath(cwd = process.cwd(), env = process.env) {
  return projectStateDir(cwd, env);
}

export function globalMemoryDir(env = process.env) {
  return path.join(poShellHome(env), "memory");
}

export function isInitialized(cwd = process.cwd(), env = process.env) {
  return fs.existsSync(path.join(poShellPath(cwd, env), "config.json"));
}

export function init(cwd = process.cwd(), env = process.env) {
  const root = poShellPath(cwd, env);
  const firstRun = !fs.existsSync(path.join(root, "config.json"));
  let migratedFrom = null;
  const legacy = legacyStateDir(cwd);
  // In the home directory, <cwd>/.po-shell IS the central home: never migrate it into itself.
  const legacyIsHome = path.resolve(legacy) === path.resolve(poShellHome(env));
  if (!legacyIsHome && !fs.existsSync(root) && fs.existsSync(legacy)) {
    ensureDir(path.dirname(root));
    try {
      fs.renameSync(legacy, root);
    } catch {
      fs.cpSync(legacy, root, { recursive: true });
      fs.rmSync(legacy, { recursive: true, force: true });
    }
    migratedFrom = legacy;
  }
  for (const dir of ["tasks", "memory", "reviews", "agents"]) {
    ensureDir(path.join(root, dir));
  }
  const identity = projectIdentity(cwd, env);
  writeJson(projectMetaPath(cwd, env), {
    id: identity.id,
    name: identity.name,
    root: identity.root,
    updatedAt: nowIso(),
  });
  const configFile = path.join(root, "config.json");
  if (!fs.existsSync(configFile)) writeJson(configFile, DEFAULT_CONFIG);
  const eventsFile = path.join(root, "events.jsonl");
  if (!fs.existsSync(eventsFile)) fs.writeFileSync(eventsFile, "");
  const gitignore = path.join(root, ".gitignore");
  if (!fs.existsSync(gitignore)) {
    fs.writeFileSync(
      gitignore,
      ["events.jsonl", "reviews/", "agents/", "active", "tasks/.seq", "*.tmp-*", ""].join("\n"),
    );
  }
  // The project's two documents are an agent aid, not a request: they appear on
  // the first run and never overwrite an existing file.
  ensureProjectDocs(cwd);
  if (firstRun) appendEvent(cwd, "init", {}, env);
  // One-time, idempotent: tasks created before `number` existed get theirs here.
  ensureTaskNumbers(cwd, env);
  return { ok: true, root, migratedFrom };
}

export function loadConfig(cwd = process.cwd(), env = process.env) {
  const config = readJson(path.join(poShellPath(cwd, env), "config.json"), DEFAULT_CONFIG);
  return {
    ...DEFAULT_CONFIG,
    ...config,
    policy: { ...DEFAULT_POLICY, ...(config.policy ?? {}) },
  };
}

export function saveConfig(cwd, patch, env = process.env) {
  const next = { ...loadConfig(cwd, env), ...patch };
  writeJson(path.join(poShellPath(cwd, env), "config.json"), next);
  return next;
}

export function appendEvent(cwd, type, data = {}, env = process.env) {
  appendJsonl(path.join(poShellPath(cwd, env), "events.jsonl"), { ts: nowIso(), type, data });
}

export function events(cwd, limit = 20, env = process.env) {
  const all = readJsonl(path.join(poShellPath(cwd, env), "events.jsonl"));
  return all.slice(-limit);
}

/* ------------------------------- tasks ---------------------------------- */

function tasksDir(cwd, env = process.env) {
  return path.join(poShellPath(cwd, env), "tasks");
}

/**
 * Two names per task. `id` is the machine key: file name, memory topic, review
 * and cost attribution, stable across renames. `number` is the human handle:
 * `#12` reads like something, `panel-de-tarea-…-mwvzoaos` does not.
 */
export function taskNumber(task) {
  const value = Number(task?.number);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

let numbering = false;

/**
 * Tasks, with the legacy ones numbered on the first read.
 *
 * Numbering is a one-time migration and every entry point lists tasks, so it
 * lives here instead of in each caller: an unnumbered task shows its id to the
 * human, which is the whole problem this fixes. The flag keeps the recursion
 * (`ensureTaskNumbers` lists tasks too) from biting.
 */
export function listTasks(cwd, env = process.env) {
  const tasks = readTasks(cwd, env);
  if (numbering || !tasks.some((task) => taskNumber(task) === 0)) return tasks;
  numbering = true;
  try {
    ensureTaskNumbers(cwd, env);
  } catch {
    // Un directorio de tareas sin permiso de escritura sigue listando.
  } finally {
    numbering = false;
  }
  return readTasks(cwd, env);
}

/** `#12` when there is a number, the id otherwise. */
export function taskLabelOf(task) {
  const number = taskNumber(task);
  return number ? `#${number}` : String(task?.id ?? "");
}

const IN_PROGRESS_PHASES = new Set(["implementing", "checking"]);

/**
 * The tasks being worked on that are not the active one, as `#37 implementing`,
 * ordered by number and capped at three: a growing list would stop being read.
 */
function otherInProgress(cwd, activeId = null, env = process.env) {
  return listTasks(cwd, env)
    .filter((task) => IN_PROGRESS_PHASES.has(task.phase) && task.id !== activeId)
    .sort((a, b) => taskNumber(a) - taskNumber(b))
    .slice(0, 3)
    .map((task) => `${taskLabelOf(task)} ${task.phase}`);
}

// The counter lives beside the tasks as a bare number, not JSON: `listTasks`
// reads every `*.json` in that directory and would take the counter for a task.
function taskSeqPath(cwd, env = process.env) {
  return path.join(tasksDir(cwd, env), ".seq");
}

function readTaskSeq(cwd, env = process.env) {
  try {
    return Math.max(0, Math.trunc(Number(fs.readFileSync(taskSeqPath(cwd, env), "utf8").trim()) || 0));
  } catch {
    return 0;
  }
}

function writeTaskSeq(cwd, value, env = process.env) {
  try {
    fs.writeFileSync(taskSeqPath(cwd, env), `${Math.max(0, Math.trunc(value))}\n`);
  } catch {
    // Sin contador se cae al máximo de las tareas: peor, pero no rompe.
  }
}

/**
 * Tasks created before `number` existed are numbered once, by creation order,
 * and persisted: a derived index would shift the day a task is removed.
 */
export function ensureTaskNumbers(cwd, env = process.env) {
  const tasks = listTasks(cwd, env).sort((a, b) =>
    String(a?.createdAt ?? "").localeCompare(String(b?.createdAt ?? "")),
  );
  let next = tasks.reduce((max, task) => Math.max(max, taskNumber(task)), readTaskSeq(cwd, env));
  const highest = next;
  let changed = 0;
  for (const task of tasks) {
    if (taskNumber(task) > 0) continue;
    next += 1;
    writeJson(path.join(tasksDir(cwd, env), `${task.id}.json`), { ...task, number: next });
    changed += 1;
  }
  if (next > highest) writeTaskSeq(cwd, next, env);
  return changed;
}

/** The next number only moves forward: deleting the newest task frees nothing. */
export function nextTaskNumber(cwd, env = process.env) {
  const highest = listTasks(cwd, env).reduce((max, task) => Math.max(max, taskNumber(task)), 0);
  const next = Math.max(highest, readTaskSeq(cwd, env)) + 1;
  writeTaskSeq(cwd, next, env);
  return next;
}

function activeFile(cwd, env = process.env) {
  return path.join(poShellPath(cwd, env), "active");
}

export function setActiveTask(cwd, id, env = process.env) {
  fs.writeFileSync(activeFile(cwd, env), `${id}\n`);
}

export function activeTaskId(cwd, env = process.env) {
  try {
    return fs.readFileSync(activeFile(cwd, env), "utf8").trim() || null;
  } catch {
    return null;
  }
}

export function getTask(cwd, id, env = process.env) {
  const ref = String(id ?? "").trim();
  if (!ref) return null;
  // `12` or `#12` is the human handle; anything else is the exact id.
  const numeric = ref.replace(/^#/, "");
  if (/^\d+$/.test(numeric)) {
    const wanted = Number(numeric);
    return listTasks(cwd, env).find((task) => taskNumber(task) === wanted) ?? null;
  }
  return readJson(path.join(tasksDir(cwd, env), `${ref}.json`), null);
}

/** Tasks as they are on disk: no numbering, no side effects. */
function readTasks(cwd, env = process.env) {
  const dir = tasksDir(cwd, env);
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => readJson(path.join(dir, f), null))
      .filter(Boolean)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  } catch {
    return [];
  }
}

// Cost belongs to the task that is being worked on. A finished or blocked task
// left active in the state directory must not absorb a new session's spend.
const ATTRIBUTABLE_PHASES = new Set(["authorized", "planned", "implementing", "checking"]);

export function attributableTask(cwd, env = process.env) {
  const task = activeTask(cwd, env);
  return task && ATTRIBUTABLE_PHASES.has(task.phase) ? task : null;
}

export function activeTask(cwd, env = process.env) {
  const id = activeTaskId(cwd, env);
  if (id) {
    const task = getTask(cwd, id, env);
    if (task) return task;
  }
  return listTasks(cwd, env)[0] ?? null;
}

export function createTask(
  cwd,
  {
    title,
    risk = "medium",
    scope = "",
    outOfScope = "",
    acceptance = [],
    plan = "",
    planSummary = "",
    delegation,
    featureDoc = "",
  },
  env = process.env,
) {
  if (!title || !String(title).trim()) throw new Error("task title is required");
  if (!RISKS.includes(risk)) throw new Error(`risk must be one of ${RISKS.join(", ")}`);
  init(cwd, env);
  const doc = String(featureDoc ?? "").trim();
  if (doc) assertFeatureDoc(cwd, doc);
  if (delegation && !DELEGATIONS.includes(delegation)) {
    throw new Error(`delegation must be one of ${DELEGATIONS.join(", ")}`);
  }
  const configured = loadConfig(cwd, env).delegation;
  const mode =
    delegation ?? (DELEGATIONS.includes(configured) ? configured : risk === "low" ? "inline" : "delegate-writes");
  const id = `${slugify(title)}-${Date.now().toString(36)}`;
  const number = nextTaskNumber(cwd, env);
  const task = {
    id,
    number,
    // `worktree` is the human's decision: `setTaskIsolation` is the only path to
    // it, and that path is the CLI, not a tool the model can call.
    isolation: "none",
    featureDoc: doc,
    title: String(title).trim(),
    phase: "authorized",
    risk,
    planApproved: risk !== "high",
    scope: String(scope ?? ""),
    outOfScope: String(outOfScope ?? ""),
    plan: String(plan ?? ""),
    // One or two lines for the approval dialogue; the detail lives in `plan`.
    planSummary: String(planSummary ?? "").trim().slice(0, 400),
    acceptance: Array.isArray(acceptance) ? acceptance : [],
    evidence: [],
    delegation: mode,
    next: "",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  writeJson(path.join(tasksDir(cwd, env), `${id}.json`), task);
  setActiveTask(cwd, id, env);
  appendEvent(cwd, "task.created", { id, title: task.title, risk }, env);
  return task;
}

export function updateTask(cwd, id, patch = {}, env = process.env) {
  // Naming a task is working it: an explicit id moves the pointer, so evidence and
  // the review follow the task the caller named instead of whatever was active.
  const explicit = Boolean(id);
  const task = explicit ? getTask(cwd, id, env) : activeTask(cwd, env);
  if (!task) throw new Error("no active task");
  const cleanPatch = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  );
  if (cleanPatch.phase && !PHASES.includes(cleanPatch.phase)) {
    throw new Error(`phase must be one of ${PHASES.join(", ")}`);
  }
  if (cleanPatch.risk && !RISKS.includes(cleanPatch.risk)) {
    throw new Error(`risk must be one of ${RISKS.join(", ")}`);
  }
  if (cleanPatch.delegation && !DELEGATIONS.includes(cleanPatch.delegation)) {
    throw new Error(`delegation must be one of ${DELEGATIONS.join(", ")}`);
  }
  const next = {
    ...task,
    ...cleanPatch,
    id: task.id,
    createdAt: task.createdAt,
    updatedAt: nowIso(),
    evidence: cleanPatch.evidence ?? task.evidence,
  };
  // The clock starts when the work starts. `ready` only accepts a check that ran
  // after this instant, so evidence from an earlier round cannot vouch for this
  // one. Re-entering `implementing` (including a failed check) moves the clock.
  if (next.phase === "implementing" && task.phase !== "implementing") {
    next.implementingAt = next.updatedAt;
  }
  if (
    next.risk === "high" &&
    next.phase === "implementing" &&
    next.planApproved !== true
  ) {
    throw new Error(
      "high-risk task requires plan approval before implementing. Show the plan and call po_shell_task with action=approve.",
    );
  }
  if (next.phase === "implementing" && next.risk !== "low") {
    assertFeatureDoc(cwd, next.featureDoc, "a medium or high task needs `feature_doc` before implementing: write docs/features/<slug>.md and pass it to po_shell_task");
  }
  if (next.phase === "ready") {
    const passing = (next.evidence ?? []).filter(
      (item) => item.kind === "checks" && item.ok === true,
    );
    if (passing.length === 0) {
      throw new Error("cannot move to ready without a passing po_shell_check evidence entry");
    }
    if (!next.implementingAt) {
      throw new Error(
        "cannot move to ready before implementing: the task never entered implementing, so no check can prove the work",
      );
    }
    const since = Date.parse(next.implementingAt);
    const fresh = passing.some((item) => {
      const ts = Date.parse(item.ts ?? "");
      return Number.isFinite(ts) && ts >= since;
    });
    if (!fresh) {
      throw new Error(
        "cannot move to ready: the passing checks evidence is older than the last move to implementing; run po_shell_check again",
      );
    }
  }
  if (next.phase === "delivered" && next.risk === "high") {
    const review = latestReview(cwd, env);
    if (!review || review.taskId !== next.id) {
      throw new Error("high-risk delivery requires a frozen review for this task");
    }
  }
  writeJson(path.join(tasksDir(cwd, env), `${task.id}.json`), next);
  // The pointer moves only once the patch landed: a rejected patch (invalid phase,
  // ready without evidence, the feature_doc gate) leaves it exactly where it was.
  if (explicit && activeTaskId(cwd, env) !== task.id) setActiveTask(cwd, task.id, env);
  appendEvent(cwd, "task.updated", { id: task.id, phase: next.phase, patch: cleanPatch }, env);
  return next;
}

/**
 * The exact command a human copies to isolate a task. The orchestrator shows this
 * instead of deciding: the command is the decision.
 */
export function isolationCommand(task, target = "worktree") {
  const handle = taskLabelOf(task);
  return `po-shell task isolation ${target}${handle ? ` ${handle}` : ""}`;
}

/**
 * Record a decision the human made, in the same turn it was made.
 *
 * The id and the total go back to the caller so a missed capture is visible right
 * away; the line lands in the feature document's `## Decisions`, which survives a
 * compaction, and in the task JSON, which is what the kernel can query.
 */
/** A feature doc that does not exist is a mission with no design. */
function assertFeatureDoc(cwd, doc, missing = "`feature_doc` does not exist: write docs/features/<slug>.md first") {
  const value = String(doc ?? "").trim();
  if (!value) throw new Error(missing);
  if (!/\.md$/i.test(value)) throw new Error("`feature_doc` must be a markdown file");
  if (!fs.existsSync(path.resolve(cwd, value))) throw new Error(`feature_doc does not exist: ${value}`);
}

/**
 * What a mission reads first: the slice's feature doc, then the files the parent
 * named. Duplicates collapse, so the kernel can add the doc without the parent
 * having to remember it.
 */
export function missionContextFiles(cwd, given = [], env = process.env) {
  const task = activeTask(cwd, env);
  const doc = String(task?.featureDoc ?? "").trim();
  const list = (Array.isArray(given) ? given : []).map((item) => String(item).trim()).filter(Boolean);
  const merged = doc ? [doc, ...list.filter((item) => item !== doc)] : list;
  return [...new Set(merged)];
}

export function addDecision(cwd, { text, taskId, by = "human", durable = false } = {}, env = process.env) {
  const task = taskId ? getTask(cwd, taskId, env) : activeTask(cwd, env);
  if (!task) throw new Error("a decision needs a task: create one first");
  const body = `${decisionByPrefix(by)}${String(text ?? "").trim()}`.trim();
  if (body.length < 8) throw new Error("a decision needs its text (at least 8 characters)");

  const stored = Array.isArray(task.decisions) ? task.decisions : [];
  const file = docPath(cwd, task.featureDoc ?? task.feature_doc);
  const source = file ? readDoc(file) : "";
  const fromTask = stored.reduce((max, item) => Math.max(max, Number(String(item?.id ?? "").slice(1)) || 0), 0);
  const fromDoc = Number(nextDecisionId(source).slice(1)) - 1;
  const id = `D${Math.max(fromTask, fromDoc) + 1}`;

  if (file) fs.writeFileSync(file, appendDecision(source, { id, line: body }));
  const decisions = [...stored, { id, text: body, by: String(by ?? "human"), at: nowIso() }];
  updateTask(cwd, task.id, { decisions }, env);
  appendEvent(cwd, "task.decision", { id, text: body, doc: file || null }, env);

  // A decision that outlives the slice is a memory: the `D<n>` binds the units, the
  // memory is what a search finds months later. One call, both artifacts.
  let memory = null;
  if (durable === true) {
    try {
      memory = saveMemory(cwd, {
        title: `Decision ${id}: ${body.slice(0, 80)}`,
        what: body,
        why: `Decisión tomada en la tarea ${taskLabelOf(task)}.`,
        where: file || `tasks/${task.id}.json`,
        learned: body,
        type: "lesson",
        topic: `lesson/decision-${id.toLowerCase()}`,
        aliases: `decision, ${id}`,
      }, env);
    } catch {
      memory = null;
    }
  }

  const orphans = file ? orphanDecisions(readDoc(file)) : [];
  return { id, total: decisions.length, orphans, doc: file, by: String(by ?? "human"), durable: durable === true, memory };
}

/** Only a human runs this (CLI). The orchestrator's tools do not expose it. */
export function setTaskIsolation(cwd, id, isolation, env = process.env) {
  const next = String(isolation ?? "").trim().toLowerCase();
  if (!["none", "worktree"].includes(next)) {
    throw new Error(`isolation must be one of none, worktree`);
  }
  const task = id ? getTask(cwd, id, env) : activeTask(cwd, env);
  if (!task) throw new Error("no active task");
  const updated = { ...task, isolation: next, updatedAt: nowIso() };
  writeJson(path.join(tasksDir(cwd, env), `${task.id}.json`), updated);
  appendEvent(cwd, "task.isolation", { id: task.id, isolation: next }, env);
  return updated;
}

export function addEvidence(cwd, evidence, env = process.env) {
  const task = activeTask(cwd, env);
  if (!task) return null;
  const next = {
    ...task,
    evidence: [...(task.evidence ?? []), evidence].slice(-50),
    updatedAt: nowIso(),
  };
  writeJson(path.join(tasksDir(cwd, env), `${task.id}.json`), next);
  appendEvent(cwd, "task.evidence", { id: task.id, ok: evidence.ok, command: evidence.command }, env);
  return next;
}

/* ------------------------------- memory --------------------------------- */

function memoryDir(cwd, env = process.env) {
  return path.join(poShellPath(cwd, env), "memory");
}

function memoryIndexFile(cwd, env = process.env) {
  return path.join(memoryDir(cwd, env), "index.json");
}

function memoryDb(cwd, env = process.env) {
  return openContextDb(contextDbPath(env));
}

function ensureProjectRow(db, cwd, env = process.env) {
  const identity = projectIdentity(cwd, env);
  db.prepare(
    `INSERT INTO projects(id, name, root, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       root = excluded.root,
       updated_at = excluded.updated_at`,
  ).run(identity.id, identity.name, identity.root, nowIso());
  return identity;
}

export function memoryIndex(cwd, env = process.env) {
  const dbPath = contextDbPath(env);
  if (!fs.existsSync(dbPath)) return [];
  const db = openContextDb(dbPath);
  try {
    const project = projectIdentity(cwd, env);
    return db
      .prepare(
        `SELECT memory_key AS slug, memory_key AS topic, title, type, scope, priority, trigger, aliases, updated_at AS updated
         FROM memories WHERE project_id = ? ORDER BY memory_key`,
      )
      .all(project.id);
  } finally {
    db.close();
  }
}

export function globalMemoryIndex(env = process.env) {
  const dbPath = contextDbPath(env);
  if (!fs.existsSync(dbPath)) return [];
  const db = openContextDb(dbPath);
  try {
    return db
      .prepare(
        `SELECT memory_key AS slug, memory_key AS topic, title, type, scope, priority, trigger, aliases, updated_at AS updated
         FROM memories WHERE project_id = ? ORDER BY memory_key`,
      )
      .all(GLOBAL_PROJECT_ID);
  } finally {
    db.close();
  }
}

export function saveMemory(
  cwd,
  {
    title,
    what,
    why = "",
    where = "",
    learned = "",
    topic = "",
    type = "",
    scope = "",
    priority = "",
    trigger = "",
    aliases = "",
    status = "",
  },
  env = process.env,
) {
  const displayTitle =
    String(title ?? "").trim() ||
    String(what ?? "").split("\n")[0].trim().slice(0, 80);
  if (!displayTitle) throw new Error("memory title is required (or provide what)");
  const isGlobal = scope === "global";
  const dir = isGlobal ? globalMemoryDir(env) : path.join(projectStateDir(cwd, env), "memory");
  if (isGlobal) ensureDir(dir);
  else init(cwd, env);
  const slug = slugify(topic || displayTitle);
  const file = path.join(dir, `${slug}.md`);
  const aliasText = Array.isArray(aliases) ? aliases.join(", ") : String(aliases ?? "").trim();
  const meta = [`- topic: ${topic || slug}`];
  if (type) meta.push(`- type: ${type}`);
  if (scope) meta.push(`- scope: ${scope}`);
  if (priority) meta.push(`- priority: ${priority}`);
  if (trigger) meta.push(`- trigger: ${trigger}`);
  if (aliasText) meta.push(`- aliases: ${aliasText}`);
  if (status) meta.push(`- status: ${status}`);
  const updatedAt = nowIso();
  meta.push(`- updated: ${updatedAt}`);
  const body = [
    `# ${displayTitle}`,
    "",
    ...meta,
    "",
    "## What",
    what || "",
    "",
    "## Why",
    why,
    "",
    "## Where",
    where,
    "",
    "## Learned",
    learned,
    "",
  ].join("\n");
  fs.writeFileSync(file, body);

  const db = memoryDb(cwd, env);
  try {
    const projectId = isGlobal ? GLOBAL_PROJECT_ID : ensureProjectRow(db, cwd, env).id;
    const stat = fs.statSync(file);
    const rel = path.relative(cwd, file).split(path.sep).join("/");
    db.prepare(
      `INSERT INTO memories(
         memory_key, project_id, scope, type, priority, trigger, status,
         title, content, aliases, path, hash, mtime, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, memory_key) DO UPDATE SET
         scope = excluded.scope, type = excluded.type, priority = excluded.priority,
         trigger = excluded.trigger, status = excluded.status, title = excluded.title,
         content = excluded.content, aliases = excluded.aliases, path = excluded.path,
         hash = excluded.hash, mtime = excluded.mtime, updated_at = excluded.updated_at`,
    ).run(
      slug,
      projectId,
      isGlobal ? "global" : "project",
      type || "memory",
      priority || "medium",
      trigger || null,
      status || "active",
      displayTitle,
      body,
      aliasText || null,
      rel,
      sha256(body),
      Math.floor(stat.mtimeMs),
      updatedAt,
    );
  } finally {
    db.close();
  }

  const indexFile = path.join(dir, "index.json");
  const index = readJson(indexFile, []).filter((entry) => entry.slug !== slug);
  const entry = { slug, title: displayTitle, topic: topic || slug, updated: updatedAt };
  if (type) entry.type = type;
  if (scope) entry.scope = scope;
  if (priority) entry.priority = priority;
  if (aliasText) entry.aliases = aliasText;
  index.push(entry);
  writeJson(indexFile, index.sort((a, b) => a.slug.localeCompare(b.slug)));
  if (!isGlobal) appendEvent(cwd, "memory.saved", { slug, title: displayTitle, type: type || "memory" }, env);
  return { slug, file, scope: isGlobal ? "global" : "project" };
}

export function searchMemory(cwd, query, limit = 5, env = process.env) {
  const terms = String(query ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!terms.length) return [];
  const dbPath = contextDbPath(env);
  if (!fs.existsSync(dbPath)) return [];
  const db = openContextDb(dbPath);
  try {
    const project = projectIdentity(cwd, env);
    const rows = db
      .prepare(
        `SELECT memory_key AS slug, title, content, type, scope, path, updated_at
         FROM memories WHERE project_id = ? OR project_id = ?`,
      )
      .all(project.id, GLOBAL_PROJECT_ID);
    const results = [];
    for (const row of rows) {
      const lower = `${row.slug}\n${row.title}\n${row.content}\n${row.path ?? ""}`.toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (row.slug.toLowerCase().includes(term)) score += 6;
        const first = lower.indexOf(term);
        if (first >= 0) score += 1 + Math.min(4, lower.split(term).length - 1);
      }
      if (!score) continue;
      const first = Math.min(
        ...terms.map((t) => {
          const i = lower.indexOf(t);
          return i < 0 ? Number.MAX_SAFE_INTEGER : i;
        }),
      );
      const start = Math.max(0, first - 120);
      results.push({
        slug: row.slug,
        score,
        type: row.type,
        scope: row.scope,
        path: row.path,
        snippet: row.content.slice(start, start + 360).replace(/\s+/g, " ").trim(),
      });
    }
    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  } finally {
    db.close();
  }
}

/* ------------------------------- agents --------------------------------- */

export function saveAgentArtifact(
  cwd,
  { id, meta = {}, output = "", events = [], maxEvents = 2000 },
  env = process.env,
) {
  const dir = path.join(poShellPath(cwd, env), "agents", id);
  ensureDir(dir);
  const createdAt = nowIso();
  const cleanMeta = {
    ...meta,
    id,
    createdAt,
  };
  writeJson(path.join(dir, "meta.json"), cleanMeta);
  fs.writeFileSync(
    path.join(dir, "result.md"),
    [
      `# po-shell agent ${id}`,
      "",
      `created: ${createdAt}`,
      `status: ${cleanMeta.status ?? "unknown"}`,
      `role: ${cleanMeta.role ?? "unknown"}`,
      "",
      output.trim(),
      "",
    ].join("\n"),
  );
  let eventsPath = null;
  if (events.length) {
    const lines = events.slice(-maxEvents).map((event) => JSON.stringify(event));
    eventsPath = path.join(dir, "events.jsonl");
    fs.writeFileSync(eventsPath, `${lines.join("\n")}\n`);
  }
  return {
    id,
    dir,
    metaPath: path.join(dir, "meta.json"),
    resultPath: path.join(dir, "result.md"),
    eventsPath,
  };
}

/* ------------------------------- checks --------------------------------- */

export function runChecks(cwd, commands = null, env = process.env) {
  const config = loadConfig(cwd, env);
  const list = commands?.length ? commands : config.checks;
  if (!list?.length) {
    throw new Error(
      `no checks configured. Edit ${path.join(poShellPath(cwd, env), "config.json")} or pass commands.`,
    );
  }
  const task = activeTask(cwd, env);
  // A check on a task that is not being worked on is a preflight: it records
  // evidence but moves no phase, because there is no `implementingAt` to prove.
  const working = Boolean(task) && ["implementing", "checking"].includes(task.phase);
  if (working) updateTask(cwd, task.id, { phase: "checking" }, env);
  const results = list.map((command) => {
    const started = Date.now();
    const proc = spawnSync(command, {
      cwd,
      shell: true,
      encoding: "utf8",
      timeout: 15 * 60 * 1000,
      env: process.env,
    });
    const ok = proc.status === 0;
    return {
      command,
      ok,
      exitCode: proc.status,
      ms: Date.now() - started,
      output: tail(`${proc.stdout ?? ""}${proc.stderr ?? ""}`, 3000),
    };
  });
  const ok = results.every((r) => r.ok);
  // The evidence belongs to one task and `addEvidence` returns it: handing it back
  // is what lets the tool say where the evidence landed before it is too late.
  const recorded = addEvidence(cwd, { ts: nowIso(), kind: "checks", ok, results }, env);
  if (working) updateTask(cwd, task.id, { phase: ok ? "ready" : "implementing" }, env);
  appendEvent(cwd, "checks.run", { ok, commands: list }, env);
  return {
    ok,
    results,
    task: recorded
      ? { id: recorded.id, number: taskNumber(recorded), phase: recorded.phase, title: recorded.title }
      : null,
  };
}

/* ------------------------------- review --------------------------------- */

function git(cwd, args) {
  const proc = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 60_000 });
  if (proc.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${(proc.stderr || proc.stdout || "").trim()}`);
  }
  return proc.stdout;
}

function tryGit(cwd, args) {
  const proc = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 60_000 });
  return proc.status === 0 ? proc.stdout.trim() : "";
}

const RISK_RANK = { low: 0, medium: 1, high: 2 };

function riskFor(cwd, changedLines, files, env = process.env) {
  const task = activeTask(cwd, env);
  const risky =
    /(^|\/)(auth|security|permission|permissions|payment|payments|billing|migration|migrations|schema|infra|deploy|dockerfile|terraform|\.env|secrets?)(\/|$|\.)/i;
  let inferred = "low";
  if (files.some((file) => risky.test(file)) || changedLines > 400) inferred = "high";
  else if (changedLines > 100) inferred = "medium";

  const taskRisk = task?.risk ?? "low";
  return RISK_RANK[taskRisk] >= RISK_RANK[inferred] ? taskRisk : inferred;
}

export function freezeReview(cwd, { base = "HEAD" } = {}, env = process.env) {
  init(cwd, env);
  if (!tryGit(cwd, ["rev-parse", "--is-inside-work-tree"])) {
    throw new Error("not a git repository");
  }
  const pathspec = [".", ":(exclude).po-shell/**"];
  let diff = git(cwd, ["diff", base, "--", ...pathspec]);
  const untracked = tryGit(cwd, ["ls-files", "--others", "--exclude-standard", "--", ...pathspec])
    .split("\n")
    .filter(Boolean);

  // numstat only sees tracked files: count the untracked content here so the
  // frozen diff's own bytes are what infer risk and maxChangedLines.
  let untrackedLines = 0;
  for (const file of untracked.slice(0, 200)) {
    try {
      const full = path.join(cwd, file);
      const stat = fs.statSync(full);
      if (!stat.isFile() || stat.size > 200_000) continue;
      const content = fs.readFileSync(full, "utf8");
      diff += `\n--- untracked: ${file} ---\n${content}`;
      untrackedLines += content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
    } catch {
      /* ignore */
    }
  }

  if (!diff.trim()) throw new Error("no changes to review");

  const numstat = tryGit(cwd, ["diff", base, "--numstat", "--", ...pathspec])
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [added, deleted, file] = line.split("\t");
      return { added: Number(added) || 0, deleted: Number(deleted) || 0, file };
    });
  const added = numstat.reduce((n, f) => n + f.added, 0) + untrackedLines;
  const deleted = numstat.reduce((n, f) => n + f.deleted, 0);
  const files = [...new Set([...numstat.map((f) => f.file), ...untracked])];
  const risk = riskFor(cwd, added + deleted, files, env);
  const config = loadConfig(cwd, env);
  const limit = Number(config.policy?.maxChangedLines ?? config.maxChangedLines) || 400;
  const overLimit = added + deleted > limit;
  const hash = sha256(diff);
  const id = `review-${Date.now().toString(36)}`;
  const dir = path.join(poShellPath(cwd, env), "reviews", id);
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, "diff.patch"), diff);
  const meta = {
    id,
    base,
    head: tryGit(cwd, ["rev-parse", "HEAD"]),
    hash,
    files,
    added,
    deleted,
    risk,
    limit,
    overLimit,
    status: "frozen",
    taskId: activeTask(cwd, env)?.id ?? null,
    createdAt: nowIso(),
  };
  writeJson(path.join(dir, "meta.json"), meta);
  appendEvent(cwd, "review.frozen", { id, hash, risk, added, deleted, files: files.length }, env);
  return meta;
}

export function latestReview(cwd, env = process.env) {
  const dir = path.join(poShellPath(cwd, env), "reviews");
  try {
    const reviews = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith("review-"))
      .map((f) => readJson(path.join(dir, f, "meta.json"), null))
      .filter(Boolean)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return reviews[0] ?? null;
  } catch {
    return null;
  }
}

export function reviewDiff(cwd, id = null, env = process.env) {
  const meta = id
    ? readJson(path.join(poShellPath(cwd, env), "reviews", id, "meta.json"), null)
    : latestReview(cwd, env);
  if (!meta) throw new Error("no review found");
  const file = path.join(poShellPath(cwd, env), "reviews", meta.id, "diff.patch");
  return { meta, diff: fs.readFileSync(file, "utf8") };
}

/* ------------------------------- status --------------------------------- */

export function status(cwd = process.cwd(), options = {}) {
  const env = options.env ?? process.env;
  const initialized = isInitialized(cwd, env);
  const config = initialized ? loadConfig(cwd, env) : DEFAULT_CONFIG;
  const task = initialized ? activeTask(cwd, env) : null;
  return {
    initialized,
    cwd,
    activeTask: task,
    tasks: initialized ? listTasks(cwd, env).length : 0,
    checks: config.checks,
    lastReview: initialized ? latestReview(cwd, env) : null,
    policy: config.policy,
    cost:
      initialized && options.cost
        ? costSummary({ projectId: projectIdentity(cwd, env).id, env })
        : null,
    git: {
      branch: initialized ? tryGit(cwd, ["branch", "--show-current"]) : "",
      dirty: initialized ? Boolean(tryGit(cwd, ["status", "--porcelain"])) : false,
    },
  };
}

export function renderStatus(cwd = process.cwd(), env = process.env) {
  const s = status(cwd, { cost: true, env });
  if (!s.initialized) {
    return [
      "po-shell no está inicializado en este directorio.",
      "Corré: po-shell init",
    ].join("\n");
  }
  const lines = [
    `po-shell · ${path.basename(s.cwd)} · ${s.git.branch || "sin rama"}${s.git.dirty ? " · dirty" : ""}`,
  ];
  if (s.activeTask) {
    const t = s.activeTask;
    lines.push(
      `Tarea: ${taskLabelOf(t)} · ${t.id} · ${t.phase} · riesgo ${t.risk} · evidencia ${(t.evidence ?? []).length}`,
      `Título: ${t.title}`,
    );
    // Constant, one line, next to the task: the rule has to survive the turn it
    // was written in, and a list of decisions would grow with every run.
    // Two constant lines, memory first: it is the artifact that survives everything.
    lines.push(
      "rule: knowledge is saved in the turn you learn it — po_shell_memory (a bug cause, a constraint, a decision)",
      "rule: a human decision also gets an id — po_shell_task action=decision, durable: true adds the memory",
    );
    if (t.isolation === "worktree") {
      lines.push(`Aislamiento: worktree (rama por hijo, sin tocar tu árbol)`);
    }
    const pressure = readContextPressure(cwd, env);
    const shownContext = formatPressure(pressure);
    lines.push(`Delegación: ${effectiveDelegation(cwd, env)}${shownContext ? ` · Contexto: ${shownContext}` : ""}`);
    if (t.risk === "high") {
      lines.push(`Plan: ${t.planApproved === true ? "aprobado" : "pendiente de aprobación"}`);
    }
    if (t.scope) lines.push(`Scope: ${t.scope}`);
    if (t.next) lines.push(`Próximo paso: ${t.next}`);
  } else {
    lines.push("Tarea: (ninguna) — usá po_shell_task para crear una");
  }
  // The pointer is invisible: this line is what shows a check landed on the wrong
  // task while there is still time to move it.
  const others = otherInProgress(cwd, s.activeTask?.id ?? null, env);
  if (others.length) lines.push(`Otras en curso: ${others.join(" · ")}`);
  lines.push(
    `Checks: ${s.checks.length ? s.checks.join(" | ") : "(sin configurar)"}`,
    `Review: ${
      s.lastReview
        ? `${s.lastReview.id} · ${s.lastReview.risk} · ${s.lastReview.files.length} archivos · ${s.lastReview.hash.slice(0, 12)}`
        : "(ninguno)"
    }`,
  );
  if (s.cost?.events) {
    lines.push(
      `Costo harness: ${formatCredits(s.cost.credits)} créditos · ${s.cost.events} eventos ` +
        "(solo po-shell; no es el saldo de Nan)",
    );
  }
  return lines.join("\n");
}

export function renderContext(cwd = process.cwd(), env = process.env) {
  const s = status(cwd, { env });
  if (!s.initialized) return "";
  const lines = ["<po_shell_state>"];
  if (s.activeTask) {
    const t = s.activeTask;
    lines.push(
      `task: ${t.id}`,
      `phase: ${t.phase}`,
      `risk: ${t.risk}`,
      `title: ${t.title}`,
      `evidence_count: ${(t.evidence ?? []).length}`,
      `delegation: ${t.delegation ?? "inline"}`,
    );
    const others = otherInProgress(cwd, t.id, env);
    if (others.length) lines.push(`other_in_progress: ${others.join(" · ")}`);
    if (t.risk === "high") {
      lines.push(`plan_approved: ${t.planApproved === true ? "yes" : "no"}`);
    }
    if (t.scope) lines.push(`scope: ${t.scope}`);
    if (t.planSummary) lines.push(`plan_summary: ${t.planSummary}`);
    // Constant, one line, next to the task: the rule has to survive the turn it
    // was written in, and a list of decisions would grow with every run.
    // Two constant lines, memory first: it is the artifact that survives everything.
    lines.push(
      "rule: knowledge is saved in the turn you learn it — po_shell_memory (a bug cause, a constraint, a decision)",
      "rule: a human decision also gets an id — po_shell_task action=decision, durable: true adds the memory",
    );
    if (t.isolation === "worktree") {
      lines.push(`Aislamiento: worktree (rama por hijo, sin tocar tu árbol)`);
    }
    const pressure = readContextPressure(cwd, env);
    const shown = formatPressure(pressure);
    if (shown) lines.push(`context: ${shown}`);
    if (pressure) {
      const directive = contextDirective(guardLevel(pressure.ratio, loadConfig(cwd, env).contextGuard));
      if (directive) lines.push(directive);
    }
    if (t.next) lines.push(`next: ${t.next}`);
  } else {
    lines.push("task: none");
  }
  lines.push(
    "rules:",
    "- Before editing code, make sure a task exists and its phase is implementing.",
    "- Before saying a change is ready, run po_shell_check and record evidence.",
    "- Before a risky delivery, run po_shell_review freeze and inspect the frozen diff.",
    "- High-risk tasks require explicit plan approval with po_shell_task action=approve before editing.",
    "- Use context_search before re-deciding something; save What/Why/Where/Learned after.",
    "</po_shell_state>",
  );
  return lines.join("\n");
}

/* ------------------------------ policy API ------------------------------ */

// In `delegate-writes` the parent keeps decisions, exploration, the feature doc
// and commits; code mutations belong to a bounded child. Only these paths stay
// writable by the orchestrator itself.
const PARENT_WRITE_SURFACES = ["docs/features/"];

export function contextPressurePath(cwd = process.cwd(), env = process.env) {
  return path.join(poShellPath(cwd, env), "context.json");
}

export function readContextPressure(cwd = process.cwd(), env = process.env) {
  return readJson(contextPressurePath(cwd, env), null);
}

/**
 * Record how much of the window the last request used. The level is stored so a
 * caller can tell a crossing from a steady state; only a rise is an event.
 */
export function saveContextPressure(cwd, measurement, env = process.env) {
  const config = loadConfig(cwd, env);
  const guard = config.contextGuard ?? DEFAULT_CONTEXT_GUARD;
  const pressure = contextPressure(measurement);
  if (!pressure) return null;
  const level = guardLevel(pressure.ratio, guard);
  const previous = readContextPressure(cwd, env);
  const next = { ...pressure, level, at: nowIso() };
  writeJson(contextPressurePath(cwd, env), next);
  if (level !== "ok" && level !== previous?.level) {
    appendEvent(cwd, `context.${level}`, next, env);
  }
  return next;
}

/** Prompt size of an assistant message, as the provider reported it. */
export function messagePromptTokens(usage) {
  return promptTokens(usage);
}

/**
 * The profile in force. Nobody chooses it explicitly: low risk edits in place,
 * anything above it goes to a worker. An explicit task or project setting still
 * wins, so the human can raise `inline` for a typo or lower the default.
 */
export function delegationMode(cwd, env = process.env) {
  const config = loadConfig(cwd, env);
  const task = activeTask(cwd, env);
  if (task?.delegation) return task.delegation;
  if (DELEGATIONS.includes(config.delegation)) return config.delegation;
  if (!task) return "inline";
  return task.risk === "low" ? "inline" : "delegate-writes";
}

/**
 * The profile in force. `enforce` lets context pressure raise it to
 * delegate-writes: the same gate, triggered by measurement instead of a flag.
 */
export function effectiveDelegation(cwd, env = process.env) {
  const config = loadConfig(cwd, env);
  const base = delegationMode(cwd, env);
  if (base === "delegate-writes") return base;
  if (config.contextGuard?.enforce !== true) return base;
  const pressure = readContextPressure(cwd, env);
  if (!pressure) return base;
  return guardLevel(pressure.ratio, config.contextGuard) === "delegate" ? "delegate-writes" : base;
}

// Central state and scratch live outside the project root: those writes are
// never "code", so the profile does not restrict them.
function outsideProject(file, cwd) {
  const relative = path.relative(path.resolve(cwd), path.resolve(cwd, String(file ?? "")));
  return relative.startsWith("..") || path.isAbsolute(relative);
}

function parentWriteBlock(toolName, input = {}, cwd) {
  if (toolName === "write" || toolName === "edit") {
    const file = input.path ?? input.file_path ?? input.file;
    if (file == null) return null;
    if (outsideProject(file, cwd)) return null;
    if (withinSurfaces(file, PARENT_WRITE_SURFACES, cwd)) return null;
    return `po-shell policy: delegate-writes. El padre no escribe código (${file}); delegá con po_shell_delegate role=worker y sus superficies. Solo docs/features/ queda en manos del orquestador.`;
  }
  if (toolName === "bash" && typeof input.command === "string") {
    const outside = shellWriteTargets(input.command).find(
      (target) => !outsideProject(target, cwd) && !withinSurfaces(target, PARENT_WRITE_SURFACES, cwd),
    );
    if (!outside) return null;
    return `po-shell policy: delegate-writes. El padre no muta archivos (${outside}); delegá esa escritura a un worker. Commit, checks y docs/features/ siguen permitidos.`;
  }
  return null;
}

export function checkPolicy(cwd, toolName, input, env = process.env) {
  const config = loadConfig(cwd, env);
  const task = activeTask(cwd, env);
  const verdict = evaluateToolCall({
    toolName,
    input,
    cwd,
    policy: config.policy,
    activeTask: task,
  });
  if (verdict.block || verdict.confirm) return verdict;

  // A high-risk task without an approved plan cannot spend a worker: delegating is
  // the only door to code, so the approval has to close it before it opens.
  if (toolName === "po_shell_delegate" && task?.risk === "high" && task.planApproved !== true) {
    return {
      block: true,
      reason:
        `Tarea ${taskLabelOf(task)} es de riesgo alto sin plan aprobado: no se delega. ` +
        'Mostrá el plan y llamá po_shell_task con action="approve".',
    };
  }

  if (effectiveDelegation(cwd, env) !== "delegate-writes") return verdict;
  const blocked = parentWriteBlock(toolName, input, cwd);
  if (!blocked) return verdict;
  const byContext =
    (task?.delegation ?? config.delegation ?? "inline") !== "delegate-writes";
  const pressure = byContext ? readContextPressure(cwd, env) : null;
  const why = pressure ? `contexto al ${(pressure.ratio * 100).toFixed(1)}% de la ventana` : "delegate-writes";
  return { block: true, reason: `${blocked} (${why})` };
}

export { evaluateToolCall, deniedPath, deniedCommand };
