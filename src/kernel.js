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

const DEFAULT_CONFIG = {
  version: 1,
  checks: [],
  policy: DEFAULT_POLICY,
  maxChangedLines: 400,
  models: {},
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
      ["events.jsonl", "reviews/", "agents/", "active", "*.tmp-*", ""].join("\n"),
    );
  }
  if (firstRun) appendEvent(cwd, "init", {}, env);
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
  return readJson(path.join(tasksDir(cwd, env), `${id}.json`), null);
}

export function listTasks(cwd, env = process.env) {
  try {
    const dir = tasksDir(cwd, env);
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
  { title, risk = "medium", scope = "", outOfScope = "", acceptance = [], plan = "" },
  env = process.env,
) {
  if (!title || !String(title).trim()) throw new Error("task title is required");
  if (!RISKS.includes(risk)) throw new Error(`risk must be one of ${RISKS.join(", ")}`);
  init(cwd, env);
  const id = `${slugify(title)}-${Date.now().toString(36)}`;
  const task = {
    id,
    title: String(title).trim(),
    phase: "authorized",
    risk,
    planApproved: risk !== "high",
    scope: String(scope ?? ""),
    outOfScope: String(outOfScope ?? ""),
    plan: String(plan ?? ""),
    acceptance: Array.isArray(acceptance) ? acceptance : [],
    evidence: [],
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
  const task = id ? getTask(cwd, id, env) : activeTask(cwd, env);
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
  const next = {
    ...task,
    ...cleanPatch,
    id: task.id,
    createdAt: task.createdAt,
    updatedAt: nowIso(),
    evidence: cleanPatch.evidence ?? task.evidence,
  };
  if (
    next.risk === "high" &&
    next.phase === "implementing" &&
    next.planApproved !== true
  ) {
    throw new Error(
      "high-risk task requires plan approval before implementing. Show the plan and call po_shell_task with action=approve.",
    );
  }
  if (next.phase === "ready") {
    const checked = (next.evidence ?? []).some((item) => item.kind === "checks" && item.ok === true);
    if (!checked) {
      throw new Error("cannot move to ready without a passing po_shell_check evidence entry");
    }
  }
  if (next.phase === "delivered" && next.risk === "high") {
    const review = latestReview(cwd, env);
    if (!review || review.taskId !== next.id) {
      throw new Error("high-risk delivery requires a frozen review for this task");
    }
  }
  writeJson(path.join(tasksDir(cwd, env), `${task.id}.json`), next);
  appendEvent(cwd, "task.updated", { id: task.id, phase: next.phase, patch: cleanPatch }, env);
  return next;
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
  if (task) updateTask(cwd, task.id, { phase: "checking" }, env);
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
  addEvidence(cwd, { ts: nowIso(), kind: "checks", ok, results }, env);
  if (task) updateTask(cwd, task.id, { phase: ok ? "ready" : "implementing" }, env);
  appendEvent(cwd, "checks.run", { ok, commands: list }, env);
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
      `Tarea: ${t.id} · ${t.phase} · riesgo ${t.risk} · evidencia ${(t.evidence ?? []).length}`,
      `Título: ${t.title}`,
    );
    if (t.risk === "high") {
      lines.push(`Plan: ${t.planApproved === true ? "aprobado" : "pendiente de aprobación"}`);
    }
    if (t.scope) lines.push(`Scope: ${t.scope}`);
    if (t.next) lines.push(`Próximo paso: ${t.next}`);
  } else {
    lines.push("Tarea: (ninguna) — usá po_shell_task para crear una");
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
    "- Before saying a change is ready, run po_shell_check and record evidence.",
    "- Before a risky delivery, run po_shell_review freeze and inspect the frozen diff.",
    "- High-risk tasks require explicit plan approval with po_shell_task action=approve before editing.",
    "- Use context_search before re-deciding something; save What/Why/Where/Learned after.",
    "</po_shell_state>",
  );
  return lines.join("\n");
}

/* ------------------------------ policy API ------------------------------ */

export function checkPolicy(cwd, toolName, input, env = process.env) {
  const config = loadConfig(cwd, env);
  return evaluateToolCall({
    toolName,
    input,
    cwd,
    policy: config.policy,
    activeTask: activeTask(cwd, env),
  });
}

export { evaluateToolCall, deniedPath, deniedCommand };
