// Read-only project memory for the explorer subagent.
//
// A child gets the memories of the project it was launched in, and nothing
// else: no `all_projects`, no "the local query missed, try everyone else" — that
// fallback is exactly what leaks one project's context into another. Reading is
// the only thing this module can do: there is no save path here at all.
import fs from "node:fs";
import { toFtsQuery, toFtsQueryAny } from "./context.js";
import { contextDbPath, indexProject, openContextDb } from "./indexer.js";
import { projectInfo } from "./project.js";

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;
const SNIPPET_CHARS = 260;

/** `limit` clamps to 1..10; not asking (or asking garbage) means 5, never "all". */
function clampLimit(value) {
  if (value == null || String(value).trim() === "") return DEFAULT_LIMIT;
  const number = Math.trunc(Number(value));
  if (!Number.isFinite(number)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, number));
}

// The snippet comes from the FTS index (column 1 is the body), so the full
// content never leaves SQLite: a child's context is the budget.
const SELECT_PROJECT_MEMORIES = `SELECT m.memory_key, m.title, m.type,
         snippet(memories_fts, 1, '[', ']', '…', 12) AS snippet
  FROM memories_fts
  JOIN memories m ON m.rowid = memories_fts.rowid
  WHERE memories_fts MATCH ? AND m.project_id = ?
  ORDER BY bm25(memories_fts)
  LIMIT ?`;

function compactMemory(row) {
  return {
    key: row.memory_key,
    type: row.type,
    title: row.title,
    snippet: String(row.snippet ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, SNIPPET_CHARS),
  };
}

/**
 * Search the ACTIVE project's memories, read-only and compact.
 *
 * Returns `{ results: [] }` — never a throw, never another project's memory —
 * when the query is empty, the cwd is not an initialized po-shell project, or
 * the context DB does not exist yet.
 */
export function memorySearch(cwd = process.cwd(), { query, limit, env = process.env } = {}) {
  const text = String(query ?? "").trim();
  // An empty MATCH is an error in SQLite and a lie for the caller: say "no
  // results" the same way every other miss does.
  if (!text) return { results: [] };

  const fts = toFtsQuery(text);
  const ftsAny = toFtsQueryAny(text);
  if (!fts && !ftsAny) return { results: [] };

  const max = clampLimit(limit);
  const dbPath = contextDbPath(env);
  const info = projectInfo(cwd, env);
  if (!info.initialized || !fs.existsSync(dbPath)) return { results: [] };

  // The index is written by the parent's own machinery; here it only keeps new
  // memories searchable. Memories are never written from this module.
  const { project } = indexProject(cwd, { dbPath, env });

  const db = openContextDb(dbPath);
  try {
    // Exact match first, then the OR fallback — both scoped to this project.
    for (const match of [fts, ftsAny]) {
      if (!match) continue;
      const rows = db.prepare(SELECT_PROJECT_MEMORIES).all(match, project.id, max);
      if (rows.length) return { results: rows.map(compactMemory) };
    }
    return { results: [] };
  } finally {
    db.close();
  }
}
