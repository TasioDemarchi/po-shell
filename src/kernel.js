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
import { GLOBAL_PROJECT_ID, contextDbPath, openContextDb } from "./indexer.js";
import { costSummary, formatCredits } from "./costs.js";
import {
  legacyStateDir,
  plainHome,
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

const DEFAULT_CONFIG = {
  version: 1,
  checks: [],
  policy: DEFAULT_POLICY,
  maxChangedLines: 400,
  models: {},
};

export function plainPath(cwd = process.cwd(), env = process.env) {
  return projectStateDir(cwd, env);
}

export function globalMemoryDir(env = process.env) {
  return path.join(plainHome(env), "memory");
}

export function isInitialized(cwd = process.cwd(), env = process.env) {
  return fs.existsSync(path.join(plainPath(cwd, env), "config.json"));
}

export function init(cwd = process.cwd(), env = process.env) {
  const root = plainPath(cwd, env);
  const firstRun = !fs.existsSync(path.join(root, "config.json"));
  let migratedFrom = null;
  const legacy = legacyStateDir(cwd);
  if (!fs.existsSync(root) && fs.existsSync(legacy)) {
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
  const identity = projectIdentity(cwd);
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
      ["events.jsonl", "reviews/", "agents/", "active", "*.tmp-*", ""].join("\n"),
    );
  }
  if (firstRun) appendEvent(cwd, "init", {});
  return { ok: true, root, migratedFrom };
}

export function loadConfig(cwd = process.cwd()) {
  const config = readJson(path.join(plainPath(cwd), "config.json"), DEFAULT_CONFIG);
  return {
    ...DEFAULT_CONFIG,
    ...config,
    policy: { ...DEFAULT_POLICY, ...(config.policy ?? {}) },
  };
}

export function saveConfig(cwd, patch) {
  const next = { ...loadConfig(cwd), ...patch };
  writeJson(path.join(plainPath(cwd), "config.json"), next);
  return next;
}

export function appendEvent(cwd, type, data = {}) {
  appendJsonl(path.join(plainPath(cwd), "events.jsonl"), { ts: nowIso(), type, data });
}

export function events(cwd, limit = 20) {
  const all = readJsonl(path.join(plainPath(cwd), "events.jsonl"));
  return all.slice(-limit);
}

/* ------------------------------- tasks ---------------------------------- */

function tasksDir(cwd) {
  return path.join(plainPath(cwd), "tasks");
}

function activeFile(cwd) {
  return path.join(plainPath(cwd), "active");
}

export function setActiveTask(cwd, id) {
  fs.writeFileSync(activeFile(cwd), `${id}\n`);
}

export function activeTaskId(cwd) {
  try {
    return fs.readFileSync(activeFile(cwd), "utf8").trim() || null;
  } catch {
    return null;
  }
}

export function getTask(cwd, id) {
  return readJson(path.join(tasksDir(cwd), `${id}.json`), null);
}

export function listTasks(cwd) {
  try {
    return fs
      .readdirSync(tasksDir(cwd))
      .filter((f) => f.endsWith(".json"))
      .map((f) => readJson(path.join(tasksDir(cwd), f), null))
      .filter(Boolean)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  } catch {
    return [];
  }
}

export function activeTask(cwd) {
  const id = activeTaskId(cwd);
  if (id) {
    const task = getTask(cwd, id);
    if (task) return task;
  }
  return listTasks(cwd)[0] ?? null;
}

export function createTask(cwd, { title, risk = "medium", scope = "", outOfScope = "", acceptance = [] }) {
  if (!title || !String(title).trim()) throw new Error("task title is required");
  if (!RISKS.includes(risk)) throw new Error(`risk must be one of ${RISKS.join(", ")}`);
  init(cwd);
  const id = `${slugify(title)}-${Date.now().toString(36)}`;
  const task = {
    id,
    title: String(title).trim(),
    phase: "authorized",
    risk,
    planApproved: risk !== "high",
    scope: String(scope ?? ""),
    outOfScope: String(outOfScope ?? ""),
    acceptance: Array.isArray(acceptance) ? acceptance : [],
    evidence: [],
    next: "",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  writeJson(path.join(tasksDir(cwd), `${id}.json`), task);
  setActiveTask(cwd, id);
  appendEvent(cwd, "task.created", { id, title: task.title, risk });
  return task;
}

export function updateTask(cwd, id, patch = {}) {
  const task = id ? getTask(cwd, id) : activeTask(cwd);
  if (!task) throw new Error("no active task");
  if (patch.phase && !PHASES.includes(patch.phase)) {
    throw new Error(`phase must be one of ${PHASES.join(", ")}`);
  }
  if (patch.risk && !RISKS.includes(patch.risk)) {
    throw new Error(`risk must be one of ${RISKS.join(", ")}`);
  }
  const next = {
    ...task,
    ...patch,
    id: task.id,
    createdAt: task.createdAt,
    updatedAt: nowIso(),
    evidence: patch.evidence ?? task.evidence,
  };
  if (
    next.risk === "high" &&
    next.phase === "implementing" &&
    next.planApproved !== true
  ) {
    throw new Error(
      "high-risk task requires plan approval before implementing. Show the plan and call plain_task with action=approve.",
    );
  }
  if (next.phase === "ready") {
    const checked = (next.evidence ?? []).some((item) => item.kind === "checks" && item.ok === true);
    if (!checked) {
      throw new Error("cannot move to ready without a passing plain_check evidence entry");
    }
  }
  if (next.phase === "delivered" && next.risk === "high") {
    const review = latestReview(cwd);
    if (!review || review.taskId !== next.id) {
      throw new Error("high-risk delivery requires a frozen review for this task");
    }
  }
  writeJson(path.join(tasksDir(cwd), `${task.id}.json`), next);
  appendEvent(cwd, "task.updated", { id: task.id, phase: next.phase, patch });
  return next;
}

export function addEvidence(cwd, evidence) {
  const task = activeTask(cwd);
  if (!task) return null;
  const next = {
    ...task,
    evidence: [...(task.evidence ?? []), evidence].slice(-50),
    updatedAt: nowIso(),
  };
  writeJson(path.join(tasksDir(cwd), `${task.id}.json`), next);
  appendEvent(cwd, "task.evidence", { id: task.id, ok: evidence.ok, command: evidence.command });
  return next;
}

/* ------------------------------- memory --------------------------------- */

function memoryDir(cwd) {
  return path.join(plainPath(cwd), "memory");
}

function memoryIndexFile(cwd) {
  return path.join(memoryDir(cwd), "index.json");
}

function memoryDb(cwd, env = process.env) {
  return openContextDb(contextDbPath(env));
}

function ensureProjectRow(db, cwd) {
  const identity = projectIdentity(cwd);
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
    const project = projectIdentity(cwd);
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
    const projectId = isGlobal ? GLOBAL_PROJECT_ID : ensureProjectRow(db, cwd).id;
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
  if (!isGlobal) appendEvent(cwd, "memory.saved", { slug, title: displayTitle, type: type || "memory" });
  return { slug, file, scope: isGlobal ? "global" : "project" };
}

export function searchMemory(cwd, query, limit = 5) {
  const terms = String(query ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!terms.length) return [];
  const dbPath = contextDbPath();
  if (!fs.existsSync(dbPath)) return [];
  const db = openContextDb(dbPath);
  try {
    const project = projectIdentity(cwd);
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
) {
  const dir = path.join(plainPath(cwd), "agents", id);
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
      `# Plain agent ${id}`,
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

export function runChecks(cwd, commands = null) {
  const config = loadConfig(cwd);
  const list = commands?.length ? commands : config.checks;
  if (!list?.length) {
    throw new Error(
      `no checks configured. Edit ${path.join(plainPath(cwd), "config.json")} or pass commands.`,
    );
  }
  const task = activeTask(cwd);
  if (task) updateTask(cwd, task.id, { phase: "checking" });
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
  addEvidence(cwd, { ts: nowIso(), kind: "checks", ok, results });
  if (task) updateTask(cwd, task.id, { phase: ok ? "ready" : "implementing" });
  appendEvent(cwd, "checks.run", { ok, commands: list });
  return { ok, results };
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

function riskFor(cwd, changedLines, files) {
  const task = activeTask(cwd);
  const risky =
    /(^|\/)(auth|security|permission|permissions|payment|payments|billing|migration|migrations|schema|infra|deploy|dockerfile|terraform|\.env|secrets?)(\/|$|\.)/i;
  let inferred = "low";
  if (files.some((file) => risky.test(file)) || changedLines > 400) inferred = "high";
  else if (changedLines > 100) inferred = "medium";

  const taskRisk = task?.risk ?? "low";
  return RISK_RANK[taskRisk] >= RISK_RANK[inferred] ? taskRisk : inferred;
}

export function freezeReview(cwd, { base = "HEAD" } = {}) {
  init(cwd);
  if (!tryGit(cwd, ["rev-parse", "--is-inside-work-tree"])) {
    throw new Error("not a git repository");
  }
  const pathspec = [".", ":(exclude).plain/**"];
  let diff = git(cwd, ["diff", base, "--", ...pathspec]);
  const untracked = tryGit(cwd, ["ls-files", "--others", "--exclude-standard", "--", ...pathspec])
    .split("\n")
    .filter(Boolean);

  for (const file of untracked.slice(0, 200)) {
    try {
      const full = path.join(cwd, file);
      const stat = fs.statSync(full);
      if (!stat.isFile() || stat.size > 200_000) continue;
      diff += `\n--- untracked: ${file} ---\n${fs.readFileSync(full, "utf8")}`;
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
  const added = numstat.reduce((n, f) => n + f.added, 0);
  const deleted = numstat.reduce((n, f) => n + f.deleted, 0);
  const files = [...new Set([...numstat.map((f) => f.file), ...untracked])];
  const risk = riskFor(cwd, added + deleted, files);
  const hash = sha256(diff);
  const id = `review-${Date.now().toString(36)}`;
  const dir = path.join(plainPath(cwd), "reviews", id);
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
    status: "frozen",
    taskId: activeTask(cwd)?.id ?? null,
    createdAt: nowIso(),
  };
  writeJson(path.join(dir, "meta.json"), meta);
  appendEvent(cwd, "review.frozen", { id, hash, risk, added, deleted, files: files.length });
  return meta;
}

export function latestReview(cwd) {
  const dir = path.join(plainPath(cwd), "reviews");
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

export function reviewDiff(cwd, id = null) {
  const meta = id ? readJson(path.join(plainPath(cwd), "reviews", id, "meta.json"), null) : latestReview(cwd);
  if (!meta) throw new Error("no review found");
  const file = path.join(plainPath(cwd), "reviews", meta.id, "diff.patch");
  return { meta, diff: fs.readFileSync(file, "utf8") };
}

/* ------------------------------- status --------------------------------- */

export function status(cwd = process.cwd(), options = {}) {
  const initialized = isInitialized(cwd);
  const config = initialized ? loadConfig(cwd) : DEFAULT_CONFIG;
  const task = initialized ? activeTask(cwd) : null;
  return {
    initialized,
    cwd,
    activeTask: task,
    tasks: initialized ? listTasks(cwd).length : 0,
    checks: config.checks,
    lastReview: initialized ? latestReview(cwd) : null,
    policy: config.policy,
    cost:
      initialized && options.cost
        ? costSummary({ projectId: projectIdentity(cwd).id })
        : null,
    git: {
      branch: initialized ? tryGit(cwd, ["branch", "--show-current"]) : "",
      dirty: initialized ? Boolean(tryGit(cwd, ["status", "--porcelain"])) : false,
    },
  };
}

export function renderStatus(cwd = process.cwd()) {
  const s = status(cwd, { cost: true });
  if (!s.initialized) {
    return [
      "Plain no está inicializado en este directorio.",
      "Corré: plain init",
    ].join("\n");
  }
  const lines = [
    `Plain · ${path.basename(s.cwd)} · ${s.git.branch || "sin rama"}${s.git.dirty ? " · dirty" : ""}`,
  ];
  if (s.activeTask) {
    const t = s.activeTask;
    lines.push(
      `Tarea: ${t.id} · ${t.phase} · riesgo ${t.risk} · evidencia ${(t.evidence ?? []).length}`,
      `Título: ${t.title}`,
    );
    if (t.risk === "high") {
      lines.push(`Plan: ${t.planApproved === true ? "aprobado" : "pendiente de aprobación"}`);
    }
    if (t.scope) lines.push(`Scope: ${t.scope}`);
    if (t.next) lines.push(`Próximo paso: ${t.next}`);
  } else {
    lines.push("Tarea: (ninguna) — usá plain_task para crear una");
  }
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
        "(solo Plain; no es el saldo de Nan)",
    );
  }
  return lines.join("\n");
}

export function renderContext(cwd = process.cwd()) {
  const s = status(cwd);
  if (!s.initialized) return "";
  const lines = ["<plain_state>"];
  if (s.activeTask) {
    const t = s.activeTask;
    lines.push(
      `task: ${t.id}`,
      `phase: ${t.phase}`,
      `risk: ${t.risk}`,
      `title: ${t.title}`,
      `evidence_count: ${(t.evidence ?? []).length}`,
    );
    if (t.risk === "high") {
      lines.push(`plan_approved: ${t.planApproved === true ? "yes" : "no"}`);
    }
    if (t.scope) lines.push(`scope: ${t.scope}`);
    if (t.next) lines.push(`next: ${t.next}`);
  } else {
    lines.push("task: none");
  }
  lines.push(
    "rules:",
    "- Before editing code, make sure a task exists and its phase is implementing.",
    "- Before saying a change is ready, run plain_check and record evidence.",
    "- Before a risky delivery, run plain_review freeze and inspect the frozen diff.",
    "- High-risk tasks require explicit plan approval with plain_task action=approve before editing.",
    "- Use context_search before re-deciding something; save What/Why/Where/Learned after.",
    "</plain_state>",
  );
  return lines.join("\n");
}

/* ------------------------------ policy API ------------------------------ */

export function checkPolicy(cwd, toolName, input) {
  const config = loadConfig(cwd);
  return evaluateToolCall({
    toolName,
    input,
    cwd,
    policy: config.policy,
    activeTask: activeTask(cwd),
  });
}

export { evaluateToolCall, deniedPath, deniedCommand };
