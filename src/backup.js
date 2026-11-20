import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  contextDbPath,
  importMissingMemories,
  openContextDb,
} from "./indexer.js";
import {
  plainHome,
  projectInfo,
  projectStateDir,
} from "./project.js";
import { ensureDir, expandHome, nowIso, readJson, sha256, writeJson } from "./util.js";

const BACKUP_VERSION = 1;
const TASK_PHASES = new Set([
  "authorized",
  "exploring",
  "planned",
  "implementing",
  "checking",
  "ready",
  "delivered",
  "blocked",
]);

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function copyDir(from, to) {
  fs.cpSync(from, to, { recursive: true, errorOnExist: true, force: false });
}

function moveAside(from, to) {
  ensureDir(path.dirname(to));
  try {
    fs.renameSync(from, to);
  } catch {
    fs.cpSync(from, to, { recursive: true });
    fs.rmSync(from, { recursive: true, force: true });
  }
}

function sqlQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function snapshotDb(dbPath, target) {
  const db = openContextDb(dbPath);
  try {
    db.exec(`VACUUM INTO ${sqlQuote(target)}`);
  } finally {
    db.close();
  }
}

function copyDbFiles(dbPath, targetDir) {
  const files = [];
  for (const suffix of ["", "-wal", "-shm"]) {
    const file = `${dbPath}${suffix}`;
    if (!fs.existsSync(file)) continue;
    const name = `context.db${suffix}`;
    fs.copyFileSync(file, path.join(targetDir, name));
    files.push(name);
  }
  return files;
}

function bundleRepo(root, output) {
  const check = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: root,
    encoding: "utf8",
  });
  if (check.status !== 0 || check.stdout.trim() !== "true") {
    return { included: false, reason: "not a git repository" };
  }
  const bundle = path.join(output, "repo.bundle");
  const result = spawnSync("git", ["bundle", "create", bundle, "--all"], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    return { included: false, reason: (result.stderr || result.stdout || "git bundle failed").trim() };
  }
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
  return {
    included: true,
    file: "repo.bundle",
    head: head.status === 0 ? head.stdout.trim() : null,
  };
}

export function createBackup(cwd = process.cwd(), options = {}) {
  const env = options.env ?? process.env;
  const project = projectInfo(cwd, env);
  const output = path.resolve(
    expandHome(options.output ?? path.join(plainHome(env), "backups", project.id, stamp())),
  );
  if (fs.existsSync(output) && fs.readdirSync(output).length > 0) {
    throw new Error(`backup output is not empty: ${output}`);
  }
  ensureDir(output);
  try {
    fs.chmodSync(output, 0o700);
  } catch {
    // Windows no aplica permisos POSIX.
  }
  const warnings = [];

  let stateIncluded = false;
  if (fs.existsSync(project.stateDir)) {
    copyDir(project.stateDir, path.join(output, "state"));
    stateIncluded = true;
  } else {
    warnings.push(`project state missing: ${project.stateDir}`);
  }

  const dbPath = project.contextDb;
  let db = { mode: "none", files: [] };
  if (fs.existsSync(dbPath)) {
    try {
      snapshotDb(dbPath, path.join(output, "context.db"));
      db = { mode: "snapshot", files: ["context.db"] };
    } catch (error) {
      warnings.push(`SQLite snapshot failed; copying raw database: ${error.message}`);
      db = { mode: "raw", files: copyDbFiles(dbPath, output) };
    }
  } else {
    warnings.push(`context database missing: ${dbPath}`);
  }

  let globalMemoryIncluded = false;
  const globalMemory = path.join(plainHome(env), "memory");
  if (fs.existsSync(globalMemory)) {
    copyDir(globalMemory, path.join(output, "global-memory"));
    globalMemoryIncluded = true;
  }

  const repo = bundleRepo(project.root, output);
  if (!repo.included) warnings.push(`repo bundle not included: ${repo.reason}`);

  const manifest = {
    version: BACKUP_VERSION,
    createdAt: nowIso(),
    project: {
      id: project.id,
      name: project.name,
      root: project.root,
    },
    state: stateIncluded ? "state" : null,
    globalMemory: globalMemoryIncluded ? "global-memory" : null,
    db,
    repo,
    warnings,
  };
  writeJson(path.join(output, "manifest.json"), manifest);
  return { ok: true, path: output, manifest };
}

export function listBackups(env = process.env, options = {}) {
  const root = path.join(plainHome(env), "backups");
  let projects;
  try {
    projects = fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  } catch {
    return [];
  }
  const backups = [];
  for (const projectEntry of projects) {
    if (options.projectId && projectEntry.name !== options.projectId) continue;
    const projectDir = path.join(root, projectEntry.name);
    let entries;
    try {
      entries = fs.readdirSync(projectDir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
    } catch {
      continue;
    }
    for (const entry of entries) {
      const backupPath = path.join(projectDir, entry.name);
      const manifest = readJson(path.join(backupPath, "manifest.json"), null);
      if (!manifest) continue;
      backups.push({ path: backupPath, manifest });
    }
  }
  return backups.sort((a, b) => String(b.manifest.createdAt).localeCompare(String(a.manifest.createdAt)));
}

function safeChild(base, relative) {
  const full = path.resolve(base, String(relative ?? ""));
  if (full !== path.resolve(base) && !full.startsWith(`${path.resolve(base)}${path.sep}`)) {
    throw new Error(`backup path escapes its directory: ${relative}`);
  }
  return full;
}

function restorePath(source, target, trashDir) {
  const trashTarget = path.join(trashDir, path.basename(target));
  const hadTarget = fs.existsSync(target);
  if (hadTarget) moveAside(target, trashTarget);
  try {
    ensureDir(path.dirname(target));
    copyDir(source, target);
  } catch (error) {
    fs.rmSync(target, { recursive: true, force: true });
    if (hadTarget && fs.existsSync(trashTarget)) moveAside(trashTarget, target);
    throw error;
  }
}

export function restoreBackup(cwd, backupSource, options = {}) {
  const env = options.env ?? process.env;
  if (options.yes !== true) {
    throw new Error("restore requires --yes");
  }
  const backupPath = path.resolve(expandHome(String(backupSource ?? "")));
  const manifest = readJson(path.join(backupPath, "manifest.json"), null);
  if (!manifest || manifest.version !== BACKUP_VERSION) {
    throw new Error(`invalid backup manifest: ${backupPath}`);
  }

  const project = projectInfo(cwd, env);
  const trashDir = path.join(plainHome(env), "trash", `restore-${stamp()}`, project.id);
  const warnings = [...(manifest.warnings ?? [])];
  if (manifest.project?.id !== project.id) {
    warnings.push(
      `backup project id ${manifest.project?.id ?? "unknown"} differs from current ${project.id}; restoring into the current project state`,
    );
  }

  if (manifest.state) {
    restorePath(safeChild(backupPath, manifest.state), project.stateDir, trashDir);
  } else {
    warnings.push("backup has no project state");
  }

  if (options.db !== false && manifest.db?.files?.length) {
    const dbPath = project.contextDb;
    const moved = [];
    for (const suffix of ["", "-wal", "-shm"]) {
      const current = `${dbPath}${suffix}`;
      if (!fs.existsSync(current)) continue;
      const target = path.join(trashDir, path.basename(current));
      moveAside(current, target);
      moved.push({ current, target });
    }
    try {
      ensureDir(path.dirname(dbPath));
      for (const file of manifest.db.files) {
        const source = safeChild(backupPath, file);
        if (!fs.existsSync(source)) {
          warnings.push(`backup database file missing: ${file}`);
          continue;
        }
        fs.copyFileSync(source, path.join(path.dirname(dbPath), path.basename(file)));
      }
    } catch (error) {
      for (const { current, target } of moved) {
        if (fs.existsSync(target)) moveAside(target, current);
      }
      throw error;
    }
  }

  if (options.global && manifest.globalMemory) {
    restorePath(
      safeChild(backupPath, manifest.globalMemory),
      path.join(plainHome(env), "memory"),
      trashDir,
    );
  }

  return {
    ok: true,
    backupPath,
    restoredTo: project.stateDir,
    trashDir,
    warnings,
  };
}

function addCheck(checks, name, ok, detail, level = "error") {
  checks.push({ name, ok: Boolean(ok), detail, level });
}

function parseJsonFile(file) {
  return readJson(file, null);
}

export function checkIntegrity(cwd = process.cwd(), options = {}) {
  const env = options.env ?? process.env;
  const project = projectInfo(cwd, env);
  const checks = [];
  const stateDir = project.stateDir;
  const stateProjectId = path.basename(stateDir);
  const configFile = path.join(stateDir, "config.json");

  addCheck(checks, "project initialized", fs.existsSync(configFile), configFile);
  if (fs.existsSync(configFile)) {
    addCheck(checks, "config JSON", parseJsonFile(configFile) !== null, configFile);
  }

  const tasksDir = path.join(stateDir, "tasks");
  let taskFiles = [];
  try {
    taskFiles = fs.readdirSync(tasksDir).filter((file) => file.endsWith(".json"));
  } catch {
    // Sin tareas todavía.
  }
  let badTasks = 0;
  for (const file of taskFiles) {
    const full = path.join(tasksDir, file);
    const task = parseJsonFile(full);
    if (!task || !task.id || !TASK_PHASES.has(task.phase)) {
      badTasks += 1;
      addCheck(checks, `task ${file}`, false, "invalid JSON or phase", "error");
    }
  }
  addCheck(checks, "task files", badTasks === 0, `${taskFiles.length} tasks, ${badTasks} invalid`);

  const activeFile = path.join(stateDir, "active");
  if (fs.existsSync(activeFile)) {
    const active = fs.readFileSync(activeFile, "utf8").trim();
    addCheck(
      checks,
      "active task",
      !active || fs.existsSync(path.join(tasksDir, `${active}.json`)),
      active || "empty",
      "warn",
    );
  }

  const eventsFile = path.join(stateDir, "events.jsonl");
  if (fs.existsSync(eventsFile)) {
    let invalid = 0;
    const lines = fs.readFileSync(eventsFile, "utf8").split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        JSON.parse(line);
      } catch {
        invalid += 1;
      }
    }
    addCheck(checks, "events JSONL", invalid === 0, `${invalid} invalid lines`, "warn");
  }

  const reviewsDir = path.join(stateDir, "reviews");
  let reviews = [];
  try {
    reviews = fs.readdirSync(reviewsDir).filter((entry) => entry.startsWith("review-"));
  } catch {
    // Sin reviews todavía.
  }
  let badReviews = 0;
  for (const id of reviews) {
    const meta = parseJsonFile(path.join(reviewsDir, id, "meta.json"));
    const diffFile = path.join(reviewsDir, id, "diff.patch");
    if (!meta || !fs.existsSync(diffFile)) {
      badReviews += 1;
      addCheck(checks, `review ${id}`, false, "missing meta or diff", "error");
      continue;
    }
    const hash = sha256(fs.readFileSync(diffFile, "utf8"));
    if (hash !== meta.hash) {
      badReviews += 1;
      addCheck(checks, `review ${id} hash`, false, `expected ${meta.hash}, got ${hash}`, "error");
    }
  }
  addCheck(checks, "review hashes", badReviews === 0, `${reviews.length} reviews, ${badReviews} invalid`);

  const dbPath = project.contextDb;
  if (fs.existsSync(dbPath)) {
    let db = null;
    try {
      db = openContextDb(dbPath);
      const result = db.prepare("PRAGMA integrity_check").all();
      const ok = result.length === 1 && result[0].integrity_check === "ok";
      addCheck(checks, "SQLite integrity", ok, JSON.stringify(result));

      let mirrorFiles = [];
      const memoryDir = path.join(stateDir, "memory");
      try {
        mirrorFiles = fs.readdirSync(memoryDir).filter((file) => file.endsWith(".md"));
      } catch {
        // Sin mirror todavía.
      }
      const rows = new Map(
        db
          .prepare("SELECT memory_key, hash FROM memories WHERE project_id = ?")
          .all(stateProjectId)
          .map((row) => [row.memory_key, row.hash]),
      );
      let missing = 0;
      let stale = 0;
      for (const file of mirrorFiles) {
        const key = path.basename(file, ".md");
        const content = fs.readFileSync(path.join(memoryDir, file), "utf8");
        if (!rows.has(key)) missing += 1;
        else if (rows.get(key) !== sha256(content)) stale += 1;
      }
      addCheck(
        checks,
        "memory mirror",
        missing === 0 && stale === 0,
        `${mirrorFiles.length} files, ${missing} missing in DB, ${stale} stale`,
        "warn",
      );
    } catch (error) {
      addCheck(checks, "SQLite integrity", false, error.message);
    } finally {
      db?.close();
    }
  } else {
    addCheck(checks, "SQLite integrity", false, `database missing: ${dbPath}`, "warn");
  }

  const errors = checks.filter((check) => !check.ok && check.level === "error");
  const warnings = checks.filter((check) => !check.ok && check.level === "warn");
  return {
    ok: errors.length === 0,
    project,
    checks,
    errors: errors.length,
    warnings: warnings.length,
  };
}

export function fixIntegrity(cwd = process.cwd(), options = {}) {
  const env = options.env ?? process.env;
  const result = importMissingMemories(cwd, { env });
  return { ...result, integrity: checkIntegrity(cwd, { env }) };
}
