import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ensureDir, expandHome, nowIso, sha256 } from "./util.js";
import { poShellHome, projectIdentity, projectStateDir } from "./project.js";

export const GLOBAL_PROJECT_ID = "__global__";
const SKIP_DIRS = new Set([
  ".git",
  ".po-shell",
  "node_modules",
  "dist",
  "build",
  "target",
  "vendor",
  "coverage",
  ".next",
  ".turbo",
  ".venv",
  "venv",
  "__pycache__",
]);
const MAX_DOC_BYTES = 1024 * 1024;
const MUTABLE_HEADING = /^(tasks?|tareas?|estado( actual)?|status|log|logbook|bitácora|bitacora|changelog|preguntas abiertas|open questions)$/;

function normalizeHeading(value) {
  return String(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();
}

export function isIndexableSection(section) {
  return !String(section.breadcrumb)
    .split(" > ")
    .some((part) => MUTABLE_HEADING.test(normalizeHeading(part)));
}

export function isFeatureDoc(rel, text = "") {
  if (/^docs\/features\//.test(rel)) return true;
  return /^---[\s\S]*?^type:\s*feature\s*$/m.test(text);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  root TEXT NOT NULL UNIQUE,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS docs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  path TEXT NOT NULL,
  hash TEXT NOT NULL,
  size INTEGER NOT NULL,
  mtime INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, path)
);
CREATE INDEX IF NOT EXISTS docs_project ON docs(project_id);

CREATE TABLE IF NOT EXISTS doc_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id INTEGER NOT NULL,
  project_id TEXT NOT NULL,
  path TEXT NOT NULL,
  heading TEXT NOT NULL,
  breadcrumb TEXT NOT NULL,
  level INTEGER NOT NULL,
  ordinal INTEGER NOT NULL,
  line_start INTEGER NOT NULL,
  line_end INTEGER NOT NULL,
  content TEXT NOT NULL,
  hash TEXT NOT NULL,
  embedding BLOB,
  embedding_model TEXT,
  embedding_hash TEXT
);
CREATE INDEX IF NOT EXISTS doc_chunks_doc ON doc_chunks(doc_id);
CREATE INDEX IF NOT EXISTS doc_chunks_project ON doc_chunks(project_id);

CREATE VIRTUAL TABLE IF NOT EXISTS doc_chunks_fts USING fts5(
  content, heading, breadcrumb, path,
  content='doc_chunks', content_rowid='id'
);
CREATE TRIGGER IF NOT EXISTS doc_chunks_ai AFTER INSERT ON doc_chunks BEGIN
  INSERT INTO doc_chunks_fts(rowid, content, heading, breadcrumb, path)
  VALUES (new.id, new.content, new.heading, new.breadcrumb, new.path);
END;
CREATE TRIGGER IF NOT EXISTS doc_chunks_ad AFTER DELETE ON doc_chunks BEGIN
  INSERT INTO doc_chunks_fts(doc_chunks_fts, rowid, content, heading, breadcrumb, path)
  VALUES ('delete', old.id, old.content, old.heading, old.breadcrumb, old.path);
END;
CREATE TRIGGER IF NOT EXISTS doc_chunks_au AFTER UPDATE ON doc_chunks BEGIN
  INSERT INTO doc_chunks_fts(doc_chunks_fts, rowid, content, heading, breadcrumb, path)
  VALUES ('delete', old.id, old.content, old.heading, old.breadcrumb, old.path);
  INSERT INTO doc_chunks_fts(rowid, content, heading, breadcrumb, path)
  VALUES (new.id, new.content, new.heading, new.breadcrumb, new.path);
END;

CREATE TABLE IF NOT EXISTS memories (
  rowid INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_key TEXT NOT NULL,
  project_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  type TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'medium',
  trigger TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  aliases TEXT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  path TEXT,
  hash TEXT NOT NULL,
  embedding BLOB,
  embedding_model TEXT,
  embedding_hash TEXT,
  mtime INTEGER,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, memory_key)
);
CREATE INDEX IF NOT EXISTS memories_project ON memories(project_id);

CREATE TABLE IF NOT EXISTS cost_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  task_id TEXT,
  task_title TEXT,
  role TEXT NOT NULL DEFAULT 'orchestrator',
  source TEXT NOT NULL DEFAULT 'chat',
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  cached_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  credits REAL NOT NULL DEFAULT 0,
  known_rates INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cost_events_project ON cost_events(project_id);
CREATE INDEX IF NOT EXISTS cost_events_task ON cost_events(task_id);
CREATE INDEX IF NOT EXISTS cost_events_created ON cost_events(created_at);

CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  title, content, type,
  content='memories', content_rowid='rowid'
);
CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, title, content, type)
  VALUES (new.rowid, new.title, new.content, new.type);
END;
CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, title, content, type)
  VALUES ('delete', old.rowid, old.title, old.content, old.type);
END;
CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, title, content, type)
  VALUES ('delete', old.rowid, old.title, old.content, old.type);
  INSERT INTO memories_fts(rowid, title, content, type)
  VALUES (new.rowid, new.title, new.content, new.type);
END;
`;

export function contextDbPath(env = process.env) {
  if (env.PO_SHELL_CONTEXT_DB) return expandHome(env.PO_SHELL_CONTEXT_DB);
  return path.join(poShellHome(env), "context.db");
}

function migrate(db) {
  const columns = new Set(
    db.prepare("PRAGMA table_info(memories)").all().map((row) => row.name),
  );
  const add = (name, sql) => {
    if (!columns.has(name)) db.exec(`ALTER TABLE memories ADD COLUMN ${sql}`);
  };
  add("priority", "priority TEXT NOT NULL DEFAULT 'medium'");
  add("trigger", "trigger TEXT");
  add("status", "status TEXT NOT NULL DEFAULT 'active'");
  add("aliases", "aliases TEXT");
  const docColumns = new Set(
    db.prepare("PRAGMA table_info(doc_chunks)").all().map((row) => row.name),
  );
  for (const [name, sql] of [
    ["embedding", "embedding BLOB"],
    ["embedding_model", "embedding_model TEXT"],
    ["embedding_hash", "embedding_hash TEXT"],
  ]) {
    if (!docColumns.has(name)) db.exec(`ALTER TABLE doc_chunks ADD COLUMN ${sql}`);
  }
  for (const [name, sql] of [
    ["embedding", "embedding BLOB"],
    ["embedding_model", "embedding_model TEXT"],
    ["embedding_hash", "embedding_hash TEXT"],
  ]) {
    if (!columns.has(name)) db.exec(`ALTER TABLE memories ADD COLUMN ${sql}`);
  }
}

export function openContextDb(dbPath = contextDbPath()) {
  ensureDir(path.dirname(dbPath));
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA);
  migrate(db);
  return db;
}


function upsertProject(db, project) {
  db.prepare(
    `INSERT INTO projects(id, name, root, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       root = excluded.root,
       updated_at = excluded.updated_at`,
  ).run(project.id, project.name, project.root, nowIso());
}

function walkMarkdown(root, dir = root, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walkMarkdown(root, abs, out);
      continue;
    }
    if (!entry.isFile() || !/\.md$/i.test(entry.name)) continue;
    let stat;
    try {
      stat = fs.statSync(abs);
    } catch {
      continue;
    }
    if (stat.size > MAX_DOC_BYTES) continue;
    out.push({
      abs,
      rel: path.relative(root, abs).split(path.sep).join("/"),
      size: stat.size,
      mtime: Math.floor(stat.mtimeMs),
    });
  }

  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

export function splitSections(text) {
  const lines = String(text).replace(/\r\n?/g, "\n").split("\n");
  const sections = [];
  let ordinal = 0;
  let fence = null;
  let stack = [];
  let current = { heading: "(intro)", breadcrumb: "(intro)", level: 0, start: 0 };

  const push = (end) => {
    const content = lines.slice(current.start, end + 1).join("\n").trim();
    if (!content) return;
    sections.push({
      ...current,
      ordinal: ordinal++,
      line_start: current.start + 1,
      line_end: end + 1,
      content,
    });
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    if (fence) {
      if (trimmed.startsWith(fence)) fence = null;
      continue;
    }
    const opening = trimmed.match(/^(```+|~~~+)/);
    if (opening) {
      fence = opening[1];
      continue;
    }

    const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!match) continue;

    push(i - 1);
    const level = match[1].length;
    const heading = match[2].trim();
    stack = stack.filter((item) => item.level < level);
    stack.push({ level, heading });
    current = {
      heading,
      breadcrumb: stack.map((item) => item.heading).join(" > "),
      level,
      start: i,
    };
  }

  push(lines.length - 1);
  return sections;
}

function clearProject(db, projectId) {
  // Memories are canonical in SQLite; never delete them on a docs rebuild.
  db.prepare("DELETE FROM doc_chunks WHERE project_id = ?").run(projectId);
  db.prepare("DELETE FROM docs WHERE project_id = ?").run(projectId);
}

function indexDocs(db, project, cwd) {
  const files = walkMarkdown(cwd);
  const existing = new Map(
    db
      .prepare("SELECT id, path, hash FROM docs WHERE project_id = ?")
      .all(project.id)
      .map((row) => [row.path, row]),
  );
  const seen = new Set();
  let updatedFiles = 0;
  let unchangedFiles = 0;
  let addedChunks = 0;

  const insertDoc = db.prepare(
    `INSERT INTO docs(project_id, path, hash, size, mtime, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const updateDoc = db.prepare(
    "UPDATE docs SET hash = ?, size = ?, mtime = ?, updated_at = ? WHERE id = ?",
  );
  const deleteChunks = db.prepare("DELETE FROM doc_chunks WHERE doc_id = ?");
  const insertChunk = db.prepare(
    `INSERT INTO doc_chunks(
       doc_id, project_id, path, heading, breadcrumb, level, ordinal,
       line_start, line_end, content, hash
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  for (const file of files) {
    const text = fs.readFileSync(file.abs, "utf8");
    const hash = sha256(text);
    seen.add(file.rel);
    const previous = existing.get(file.rel);
    if (previous && previous.hash === hash) {
      unchangedFiles += 1;
      continue;
    }

    let docId;
    if (previous) {
      docId = previous.id;
      updateDoc.run(hash, file.size, file.mtime, nowIso(), docId);
      deleteChunks.run(docId);
    } else {
      const result = insertDoc.run(
        project.id,
        file.rel,
        hash,
        file.size,
        file.mtime,
        nowIso(),
      );
      docId = Number(result.lastInsertRowid);
    }

    const sections = splitSections(text);
    const indexedSections = isFeatureDoc(file.rel, text)
      ? sections.filter(isIndexableSection)
      : sections;
    for (const section of indexedSections) {
      insertChunk.run(
        docId,
        project.id,
        file.rel,
        section.heading,
        section.breadcrumb,
        section.level,
        section.ordinal,
        section.line_start,
        section.line_end,
        section.content,
        sha256(section.content),
      );
    }
    addedChunks += indexedSections.length;
    updatedFiles += 1;
  }

  let removedFiles = 0;
  const removeChunks = db.prepare("DELETE FROM doc_chunks WHERE doc_id = ?");
  const removeDoc = db.prepare("DELETE FROM docs WHERE id = ?");
  for (const [rel, row] of existing) {
    if (seen.has(rel)) continue;
    removeChunks.run(row.id);
    removeDoc.run(row.id);
    removedFiles += 1;
  }

  const totalDocs = db
    .prepare("SELECT COUNT(*) AS n FROM docs WHERE project_id = ?")
    .get(project.id).n;
  const totalChunks = db
    .prepare("SELECT COUNT(*) AS n FROM doc_chunks WHERE project_id = ?")
    .get(project.id).n;

  return {
    files: totalDocs,
    chunks: totalChunks,
    updatedFiles,
    unchangedFiles,
    removedFiles,
    addedChunks,
  };
}

function memoryTitle(key, content) {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : key;
}

function memoryMeta(content, key, scopeDefault = "project") {
  const type = content.match(/^-\s*type:\s*(.+)$/m)?.[1]?.trim() || "memory";
  const scope = content.match(/^-\s*scope:\s*(.+)$/m)?.[1]?.trim() || scopeDefault;
  const priority = content.match(/^-\s*priority:\s*(.+)$/m)?.[1]?.trim() || "medium";
  const trigger = content.match(/^-\s*trigger:\s*(.+)$/m)?.[1]?.trim() || "";
  const status = content.match(/^-\s*status:\s*(.+)$/m)?.[1]?.trim() || "active";
  const aliases = content.match(/^-\s*aliases:\s*(.+)$/m)?.[1]?.trim() || "";
  return { type, scope, priority, trigger, status, aliases };
}

function indexMemories(db, project, cwd, options = {}) {
  const dir = options.dir ?? path.join(projectStateDir(cwd), "memory");
  const projectId = options.projectId ?? project.id;
  const scopeDefault = options.scopeDefault ?? "project";
  let files = [];
  try {
    files = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => path.join(dir, entry.name))
      .sort();
  } catch {
    // Sin memorias todavía.
  }

  const existing = new Map(
    db
      .prepare("SELECT rowid, memory_key, hash FROM memories WHERE project_id = ?")
      .all(projectId)
      .map((row) => [row.memory_key, row]),
  );
  if (existing.size > 0 && !options.missingOnly) {
    return { total: existing.size, updated: 0, unchanged: existing.size, removed: 0, imported: false };
  }
  const seen = new Set();
  let updated = 0;
  let unchanged = 0;

  const insert = db.prepare(
    `INSERT INTO memories(
       memory_key, project_id, scope, type, priority, trigger, status, aliases,
       title, content, path, hash, mtime, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const update = db.prepare(
    `UPDATE memories SET
       scope = ?, type = ?, priority = ?, trigger = ?, status = ?, aliases = ?,
       title = ?, content = ?, path = ?, hash = ?, mtime = ?, updated_at = ?
     WHERE rowid = ?`,
  );

  for (const file of files) {
    const key = path.basename(file, ".md");
    seen.add(key);
    const content = fs.readFileSync(file, "utf8");
    const hash = sha256(content);
    const previous = existing.get(key);
    if (previous) {
      unchanged += 1;
      continue;
    }

    const stat = fs.statSync(file);
    const { type, scope, priority, trigger, status, aliases } = memoryMeta(content, key, scopeDefault);
    const title = memoryTitle(key, content);
    const rel = path.relative(cwd, file).split(path.sep).join("/");
    if (previous) {
      update.run(
        scope,
        type,
        priority,
        trigger,
        status,
        aliases,
        title,
        content,
        rel,
        hash,
        Math.floor(stat.mtimeMs),
        nowIso(),
        previous.rowid,
      );
    } else {
      insert.run(
        key,
        projectId,
        scope,
        type,
        priority,
        trigger,
        status,
        aliases,
        title,
        content,
        rel,
        hash,
        Math.floor(stat.mtimeMs),
        nowIso(),
      );
    }
    updated += 1;
  }

  let removed = 0;
  if (!options.missingOnly) {
    for (const [key, row] of existing) {
      if (seen.has(key)) continue;
      db.prepare("DELETE FROM memories WHERE rowid = ?").run(row.rowid);
      removed += 1;
    }
  }

  const total = db
    .prepare("SELECT COUNT(*) AS n FROM memories WHERE project_id = ?")
    .get(projectId).n;

  return { total, updated, unchanged, removed };
}


function indexGlobalMemories(db, env = process.env, options = {}) {
  const home = poShellHome(env);
  return indexMemories(db, { id: GLOBAL_PROJECT_ID }, home, {
    dir: path.join(home, "memory"),
    projectId: GLOBAL_PROJECT_ID,
    scopeDefault: "global",
    missingOnly: options.missingOnly === true,
  });
}

export function importMissingMemories(cwd = process.cwd(), options = {}) {
  const env = options.env ?? process.env;
  const dbPath = options.dbPath ?? contextDbPath(env);
  const project = projectIdentity(cwd);
  const db = openContextDb(dbPath);
  try {
    db.exec("BEGIN");
    try {
      const memories = indexMemories(db, project, project.root, {
        dir: path.join(projectStateDir(project.root, env), "memory"),
        missingOnly: true,
      });
      const globalMemories = indexGlobalMemories(db, env, { missingOnly: true });
      db.exec("COMMIT");
      return { dbPath, project, memories, globalMemories };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    db.close();
  }
}

export function indexProject(cwd = process.cwd(), options = {}) {
  const env = options.env ?? process.env;
  const dbPath = options.dbPath ?? contextDbPath(env);
  const project = projectIdentity(cwd);
  const db = openContextDb(dbPath);

  try {
    db.exec("BEGIN");
    try {
      upsertProject(db, project);
      if (options.rebuild) clearProject(db, project.id);
      const docs = indexDocs(db, project, project.root);
      const memories = indexMemories(db, project, project.root, {
        dir: path.join(projectStateDir(project.root, env), "memory"),
      });
      const globalMemories = indexGlobalMemories(db, env);
      db.exec("COMMIT");
      return { dbPath, project, docs, memories, globalMemories };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    db.close();
  }
}
