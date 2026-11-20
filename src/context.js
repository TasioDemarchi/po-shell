import fs from "node:fs";
import {
  GLOBAL_PROJECT_ID,
  contextDbPath,
  indexProject,
  openContextDb,
} from "./indexer.js";
import { listProjectStates, projectIdentity, projectInfo, resolveProjectState } from "./project.js";
import { cosine, embedTexts, rerankDocuments, semanticConfig, vectorBuffer, vectorFromBlob } from "./semantic.js";

function termVariants(term) {
  const out = new Set([term]);
  if (term.length > 4 && term.endsWith("es")) out.add(term.slice(0, -2));
  else if (term.length > 3 && term.endsWith("s")) out.add(term.slice(0, -1));
  return [...out];
}

const STOPWORDS = new Set([
  "a","al","algo","and","are","as","at","be","by","como","con","de","del","el","en","es",
  "esta","este","for","from","in","is","la","las","lo","los","of","on","or","otra",
  "otro","para","por","que","se","sin","the","to","un","una","y","you","your",
]);

function termsFor(query) {
  return (String(query ?? "")
    .toLowerCase()
    .match(/[\p{L}\p{N}_./-]+/gu) ?? []).filter((term) => /[\p{L}\p{N}]/u.test(term));
}

function quoteTerm(term) {
  return `"${term.replace(/"/g, '""')}"`;
}

export function toFtsQuery(query) {
  const terms = termsFor(query);
  if (!terms.length) return null;
  return terms
    .map((term) => {
      const variants = termVariants(term).map(quoteTerm);
      return variants.length === 1 ? variants[0] : `(${variants.join(" OR ")})`;
    })
    .join(" AND ");
}

function isStopword(term) {
  const plain = term.normalize("NFD").replace(/\p{Diacritic}/gu, "");
  return STOPWORDS.has(plain);
}

export function toFtsQueryAny(query) {
  const terms = termsFor(query).filter((term) => !isStopword(term));
  if (!terms.length) return null;
  return terms.flatMap((term) => termVariants(term).map(quoteTerm)).join(" OR ");
}

function roundRobin(results, limit) {
  return results
    .map((item, index) => ({ ...item, score: 1 / (60 + index + 1) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

async function ensureEmbeddings(db, table, rows, idColumn, textColumn, env) {
  const config = semanticConfig(env);
  if (!config) return false;
  const pending = rows.filter(
    (row) =>
      !row.embedding ||
      row.embedding_model !== config.embeddingModel ||
      row.embedding_hash !== row.hash,
  );
  if (!pending.length) return true;
  const vectors = await embedTexts(pending.map((row) => row[textColumn]), env);
  if (!vectors || vectors.length !== pending.length) return false;
  const update = db.prepare(
    `UPDATE ${table} SET embedding = ?, embedding_model = ?, embedding_hash = ? WHERE ${idColumn} = ?`,
  );
  for (let i = 0; i < pending.length; i += 1) {
    update.run(vectorBuffer(vectors[i]), config.embeddingModel, pending[i].hash, pending[i][idColumn]);
  }
  return true;
}

function memoryResult(row, project) {
  let id;
  if (row.project_id === GLOBAL_PROJECT_ID) id = `mem:global:${row.memory_key}`;
  else if (row.project_id === project.id) id = `mem:${row.memory_key}`;
  else id = `mem:project:${row.project_id}:${row.memory_key}`;
  const source =
    row.project_id === project.id
      ? "current"
      : row.project_id === GLOBAL_PROJECT_ID
        ? "global"
        : "other";
  return {
    kind: "memory",
    id,
    title: row.title,
    type: row.type,
    scope: row.scope,
    path: row.path,
    project:
      row.project_id === GLOBAL_PROJECT_ID
        ? "global"
        : row.project_name ?? row.project_id,
    projectId: row.project_id,
    projectRoot: row.project_root ?? null,
    source,
    requiresConfirmation: source === "global",
    snippet: row.snippet ?? String(row.content ?? "").slice(0, 360).replace(/\s+/g, " ").trim(),
  };
}

function docResult(row) {
  return {
    kind: "spec",
    id: `spec:${row.path}#${row.ordinal}`,
    title: row.heading,
    path: row.path,
    heading: row.heading,
    breadcrumb: row.breadcrumb,
    ordinal: row.ordinal,
    lineStart: row.line_start,
    lineEnd: row.line_end,
    snippet: row.snippet ?? String(row.content ?? "").slice(0, 360).replace(/\s+/g, " ").trim(),
  };
}

export async function searchContext(cwd = process.cwd(), query, options = {}) {
  const env = options.env ?? process.env;
  const dbPath = options.dbPath ?? contextDbPath(env);
  const fts = toFtsQuery(query);
  const ftsAny = toFtsQueryAny(query);
  const limit = Math.max(1, Math.min(20, Number(options.limit) || 5));
  const kinds = options.kinds?.length ? new Set(options.kinds) : new Set(["spec", "memory"]);

  let selected = null;
  if (options.project) {
    selected = resolveProjectState(options.project, env);
    if (!selected?.root) {
      const names = listProjectStates(env).map((item) => item.name).join(", ");
      throw new Error(
        `proyecto no encontrado: ${options.project}. Registrados: ${names || "(ninguno)"}`,
      );
    }
  }

  const current = selected ?? projectInfo(cwd, env);
  const inProject = Boolean(selected || current.initialized);
  const indexRoot = selected?.root ?? (current.initialized ? cwd : null);
  let project = selected ? projectIdentity(selected.root) : projectIdentity(cwd);

  if (options.autoIndex !== false && indexRoot) {
    project = indexProject(indexRoot, { dbPath, env }).project;
  }

  if (!fts) return { dbPath, project, query, inProject, requiresConfirmation: false, results: [] };
  if (!fs.existsSync(dbPath)) return { dbPath, project, query, inProject, requiresConfirmation: false, results: [] };

  const db = openContextDb(dbPath);
  try {
    const fetchLimit = Math.max(limit * 3, 12);
    let docs = kinds.has("spec") && inProject
      ? db
          .prepare(
            `SELECT c.id, c.path, c.heading, c.breadcrumb, c.ordinal,
                    c.line_start, c.line_end, c.content, c.hash,
                    c.embedding, c.embedding_model, c.embedding_hash,
                    snippet(doc_chunks_fts, 0, '[', ']', '…', 16) AS snippet
             FROM doc_chunks_fts
             JOIN doc_chunks c ON c.id = doc_chunks_fts.rowid
             WHERE doc_chunks_fts MATCH ? AND c.project_id = ?
             ORDER BY bm25(doc_chunks_fts)
             LIMIT ?`,
          )
          .all(fts, project.id, fetchLimit)
      : [];

    const selectMemories = `SELECT m.rowid, m.project_id, m.memory_key, m.title, m.type, m.scope, m.path,
                m.content, m.hash, m.embedding, m.embedding_model, m.embedding_hash,
                p.name AS project_name, p.root AS project_root,
                snippet(memories_fts, 1, '[', ']', '…', 16) AS snippet
         FROM memories_fts
         JOIN memories m ON m.rowid = memories_fts.rowid
         LEFT JOIN projects p ON p.id = m.project_id
         WHERE memories_fts MATCH ?
           AND (? = '' OR m.type = ?)`;

    let memories = [];
    if (kinds.has("memory")) {
      if (inProject && !options.allProjects) {
        memories = db
          .prepare(`${selectMemories} AND m.project_id = ? ORDER BY bm25(memories_fts) LIMIT ?`)
          .all(fts, options.type ?? "", options.type ?? "", project.id, fetchLimit);
      }
      if (!memories.length) {
        memories = db
          .prepare(`${selectMemories} ORDER BY bm25(memories_fts) LIMIT ?`)
          .all(fts, options.type ?? "", options.type ?? "", fetchLimit);
      }
    }

    if (!docs.length && !memories.length && ftsAny) {
      if (kinds.has("spec") && inProject) {
        docs = db
          .prepare(
            `SELECT c.id, c.path, c.heading, c.breadcrumb, c.ordinal,
                    c.line_start, c.line_end, c.content, c.hash,
                    c.embedding, c.embedding_model, c.embedding_hash,
                    snippet(doc_chunks_fts, 0, '[', ']', '…', 16) AS snippet
             FROM doc_chunks_fts
             JOIN doc_chunks c ON c.id = doc_chunks_fts.rowid
             WHERE doc_chunks_fts MATCH ? AND c.project_id = ?
             ORDER BY bm25(doc_chunks_fts)
             LIMIT ?`,
          )
          .all(ftsAny, project.id, fetchLimit);
      }
      if (kinds.has("memory")) {
        if (inProject && !options.allProjects) {
          memories = db
            .prepare(`${selectMemories} AND m.project_id = ? ORDER BY bm25(memories_fts) LIMIT ?`)
            .all(ftsAny, options.type ?? "", options.type ?? "", project.id, fetchLimit);
        }
        if (!memories.length) {
          memories = db
            .prepare(`${selectMemories} ORDER BY bm25(memories_fts) LIMIT ?`)
            .all(ftsAny, options.type ?? "", options.type ?? "", fetchLimit);
        }
      }
    }

    const merged = new Map();
    for (const row of docs) merged.set(`spec:${row.path}#${row.ordinal}`, docResult(row));
    for (const row of memories) merged.set(memoryResult(row, project).id, memoryResult(row, project));

    let semanticUsed = false;
    if (options.semantic !== false && semanticConfig(env)) {
      try {
        const queryVector = (await embedTexts([query], env))?.[0];
        if (queryVector) {
          if (kinds.has("spec") && inProject) {
            const rows = db
              .prepare(
                `SELECT id, path, heading, breadcrumb, ordinal, line_start, line_end, content, hash,
                        embedding, embedding_model, embedding_hash
                 FROM doc_chunks WHERE project_id = ?`,
              )
              .all(project.id);
            if (await ensureEmbeddings(db, "doc_chunks", rows, "id", "content", env)) {
              const scored = rows
                .map((row) => ({ row, score: cosine(queryVector, vectorFromBlob(row.embedding)) }))
                .sort((a, b) => b.score - a.score)
                .slice(0, fetchLimit);
              for (const { row, score } of scored) {
                const item = docResult(row);
                const previous = merged.get(item.id) ?? item;
                merged.set(item.id, { ...previous, semanticScore: score });
              }
              semanticUsed = true;
            }
          }

          if (kinds.has("memory")) {
            const rows = db
              .prepare(
                `SELECT m.rowid, m.project_id, m.memory_key, m.title, m.type, m.scope, m.path,
                        m.content, m.hash, m.embedding, m.embedding_model, m.embedding_hash,
                        p.name AS project_name, p.root AS project_root
                 FROM memories m LEFT JOIN projects p ON p.id = m.project_id
                 WHERE (? = '' OR m.type = ?)`,
              )
              .all(options.type ?? "", options.type ?? "");
            if (await ensureEmbeddings(db, "memories", rows, "rowid", "content", env)) {
              const scored = rows
                .map((row) => ({ row, score: cosine(queryVector, vectorFromBlob(row.embedding)) }))
                .sort((a, b) => b.score - a.score);
              const currentHits = inProject && !options.allProjects
                ? scored.filter((item) => item.row.project_id === project.id)
                : [];
              const chosen = currentHits.some((item) => item.score > 0.25)
                ? currentHits
                : scored;
              for (const { row, score } of chosen.slice(0, fetchLimit)) {
                const item = memoryResult(row, project);
                const previous = merged.get(item.id) ?? item;
                merged.set(item.id, { ...previous, semanticScore: score });
              }
              semanticUsed = true;
            }
          }
        }
      } catch {
        // Semantic search is optional; exact search still works.
      }
    }

    let results = [...merged.values()];
    if (semanticUsed && results.length > 1) {
      try {
        const ranked = await rerankDocuments(
          query,
          results.map((item) => `${item.title}\n${item.snippet ?? ""}`),
          env,
        );
        if (ranked?.length) {
          const byIndex = new Map(ranked.map((item) => [item.index, item.score]));
          results = results
            .map((item, index) => ({ ...item, rerankScore: byIndex.get(index) ?? 0 }))
            .sort((a, b) => (b.rerankScore ?? 0) - (a.rerankScore ?? 0));
        }
      } catch {
        // Rerank is optional.
      }
    }

    const requiresConfirmation = results.some((item) => item.requiresConfirmation);
    const globalBlocked = requiresConfirmation && options.allowGlobal === false;
    if (globalBlocked) {
      results = results.filter((item) => !item.requiresConfirmation);
    }
    results = roundRobin(results, limit);
    return {
      dbPath,
      project,
      query,
      inProject,
      semantic: semanticUsed,
      requiresConfirmation,
      globalBlocked,
      results,
    };
  } finally {
    db.close();
  }
}

function parseRef(ref) {
  if (typeof ref === "string") {
    if (ref.startsWith("spec:")) {
      const rest = ref.slice("spec:".length);
      const hash = rest.lastIndexOf("#");
      if (hash < 0) throw new Error(`referencia de spec inválida: ${ref}`);
      return { kind: "spec", path: rest.slice(0, hash), ordinal: Number(rest.slice(hash + 1)) };
    }
    if (ref.startsWith("mem:global:")) {
      return {
        kind: "memory",
        global: true,
        key: ref.slice("mem:global:".length),
      };
    }
    if (ref.startsWith("mem:project:")) {
      const rest = ref.slice("mem:project:".length);
      const colon = rest.indexOf(":");
      if (colon < 0) throw new Error(`referencia cross-project inválida: ${ref}`);
      return {
        kind: "memory",
        global: false,
        projectId: rest.slice(0, colon),
        key: rest.slice(colon + 1),
      };
    }
    if (ref.startsWith("mem:")) {
      return { kind: "memory", global: false, key: ref.slice("mem:".length) };
    }
    throw new Error(
      `referencia inválida: ${ref}. Usá spec:path#ordinal, mem:key, mem:global:key o mem:project:<id>:key`,
    );
  }
  if (ref?.kind === "spec") {
    if (ref.id) return parseRef(ref.id);
    if (ref.path == null || ref.ordinal == null) {
      throw new Error("spec requiere id o path + ordinal");
    }
    return { kind: "spec", path: ref.path, ordinal: Number(ref.ordinal) };
  }
  if (ref?.kind === "memory") {
    if (ref.id) return parseRef(ref.id);
    if (!ref.key) throw new Error("memory requiere id o key");
    return {
      kind: "memory",
      global: Boolean(ref.global),
      projectId: ref.projectId,
      key: ref.key,
    };
  }
  throw new Error("kind inválido: usá spec o memory");
}

export function getContext(cwd = process.cwd(), ref, options = {}) {
  const env = options.env ?? process.env;
  const dbPath = options.dbPath ?? contextDbPath(env);
  const parsed = parseRef(ref);

  if (options.autoIndex !== false) indexProject(cwd, { dbPath, env });
  const project = projectIdentity(cwd);
  if (!fs.existsSync(dbPath)) throw new Error("no hay índice. Corré: plain index");

  const db = openContextDb(dbPath);
  try {
    if (parsed.kind === "memory") {
      const owner = parsed.global ? GLOBAL_PROJECT_ID : parsed.projectId ?? project.id;
      const row = db
        .prepare(
          `SELECT m.memory_key, m.title, m.type, m.scope, m.path, m.content, m.updated_at,
                  p.name AS project_name
           FROM memories m
           LEFT JOIN projects p ON p.id = m.project_id
           WHERE m.project_id = ? AND m.memory_key = ?`,
        )
        .get(owner, parsed.key);
      if (!row) throw new Error(`memoria no encontrada: ${parsed.key}`);
      let id;
      if (parsed.global) id = `mem:global:${row.memory_key}`;
      else if (parsed.projectId) id = `mem:project:${owner}:${row.memory_key}`;
      else id = `mem:${row.memory_key}`;
      return {
        kind: "memory",
        id,
        title: row.title,
        type: row.type,
        scope: row.scope,
        path: row.path,
        project: parsed.global ? "global" : row.project_name ?? owner,
        projectId: owner,
        content: row.content,
        updatedAt: row.updated_at,
      };
    }

    const row = db
      .prepare(
        `SELECT path, heading, breadcrumb, level, ordinal,
                line_start, line_end, content
         FROM doc_chunks WHERE project_id = ? AND path = ? AND ordinal = ?`,
      )
      .get(project.id, parsed.path, parsed.ordinal);
    if (!row) throw new Error(`sección no encontrada: ${parsed.path}#${parsed.ordinal}`);
    return {
      kind: "spec",
      id: `spec:${row.path}#${row.ordinal}`,
      path: row.path,
      heading: row.heading,
      breadcrumb: row.breadcrumb,
      level: row.level,
      ordinal: row.ordinal,
      lineStart: row.line_start,
      lineEnd: row.line_end,
      content: row.content,
    };
  } finally {
    db.close();
  }
}


function memoryRule(content) {
  const match = String(content).match(/##\s+What\s*\n([\s\S]*?)(?=\n##\s+|$)/i);
  return (match ? match[1] : content).replace(/\s+/g, " ").trim();
}

export function activeDirectives(cwd = process.cwd(), options = {}) {
  const env = options.env ?? process.env;
  const dbPath = options.dbPath ?? contextDbPath(env);
  const limit = Math.max(1, Math.min(50, Number(options.limit) || 10));
  const maxChars = Math.max(100, Number(options.maxChars) || 800);

  if (options.autoIndex !== false) indexProject(cwd, { dbPath, env });
  const project = projectIdentity(cwd);
  if (!fs.existsSync(dbPath)) return [];

  const db = openContextDb(dbPath);
  try {
    const rows = db
      .prepare(
        `SELECT project_id, memory_key, title, scope, priority, trigger, path, content, updated_at
         FROM memories
         WHERE (project_id = ? OR project_id = ?)
           AND type = 'behavior' AND status = 'active'
         ORDER BY
           CASE scope WHEN 'project' THEN 0 ELSE 1 END,
           CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
           updated_at DESC
         LIMIT ?`,
      )
      .all(project.id, GLOBAL_PROJECT_ID, limit * 5);

    const directives = [];
    let used = 0;
    for (const row of rows) {
      const rule = memoryRule(row.content);
      if (!rule) continue;
      const trigger = row.trigger ? ` (cuando: ${row.trigger})` : "";
      const line = `- [${row.scope}, ${row.priority}] ${rule}${trigger}`;
      if (used + line.length > maxChars) break;
      directives.push({
        id:
          row.project_id === GLOBAL_PROJECT_ID
            ? `mem:global:${row.memory_key}`
            : `mem:${row.memory_key}`,
        title: row.title,
        scope: row.scope,
        priority: row.priority,
        trigger: row.trigger,
        rule,
        path: row.path,
      });
      used += line.length + 1;
      if (directives.length >= limit) break;
    }
    return directives;
  } finally {
    db.close();
  }
}
