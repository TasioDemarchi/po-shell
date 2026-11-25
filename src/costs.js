import { contextDbPath, openContextDb } from "./indexer.js";
import { projectIdentity } from "./project.js";
import { nowIso } from "./util.js";

// Créditos de Nan por 1M de tokens. Fuente: tabla de precios de la suscripción.
export const NAN_RATES = {
  "deepseek-v4-flash": { input: 10.5, cached: 0.21, output: 42.0 },
  "glm5.3-flash": { input: 5.25, cached: 1.05, output: 17.5 },
  "mimo-v2.6-flash": { input: 7.0, cached: 0.14, output: 14.0 },
  "qwen3.8-flash": { input: 7.5, cached: 0.8, output: 23.5 },
  "glm5.3": { input: 49.0, cached: 9.1, output: 154.0 },
  "kimi-k3.1-pro": { input: 100.0, cached: 10.0, output: 500.0, cacheWrite: 100.0 },
  "qwen3.8-max": { input: 100.0, cached: 12.58, output: 300.0 },
  "qwen4-max": { input: 70.65, cached: 3.55, output: 212.0 },
  "deepseek-v4-pro": { input: 66.0, cached: 2.2, output: 198.0 },
  hy4: { input: 41.7, cached: 2.1, output: 125.05 },
  "hy4-flash": { input: 10.5, cached: 0.21, output: 42.0 },
};

const MODEL_ALIASES = {
  "deepseek-v4-flash-4.1-1017": "deepseek-v4-flash",
  "deepseek-v4-flash-1017": "deepseek-v4-flash",
  "deepseek-v4-pro-0813": "deepseek-v4-pro",
};

export function normalizeModel(model) {
  return String(model ?? "")
    .trim()
    .toLowerCase()
    .split("/")
    .pop();
}

export function ratesFor(model) {
  const id = normalizeModel(model);
  const canonical = MODEL_ALIASES[id] ?? id;
  return NAN_RATES[canonical] ? { id: canonical, ...NAN_RATES[canonical] } : null;
}

export function creditsFor(model, usage = {}) {
  const rates = ratesFor(model);
  const input = Math.max(0, Number(usage.input) || 0);
  const cached = Math.max(0, Number(usage.cacheRead ?? usage.cached) || 0);
  const output = Math.max(0, Number(usage.output) || 0);
  const cacheWrite = Math.max(0, Number(usage.cacheWrite) || 0);

  if (!rates) {
    return {
      model: normalizeModel(model),
      known: false,
      credits: 0,
      parts: { input: 0, cached: 0, output: 0, cacheWrite: 0 },
      tokens: { input, cached, output, cacheWrite },
    };
  }

  const parts = {
    input: (input / 1_000_000) * rates.input,
    cached: (cached / 1_000_000) * rates.cached,
    output: (output / 1_000_000) * rates.output,
    cacheWrite: (cacheWrite / 1_000_000) * (rates.cacheWrite ?? 0),
  };
  return {
    model: rates.id,
    known: true,
    rates,
    credits: Object.values(parts).reduce((sum, value) => sum + value, 0),
    parts,
    tokens: { input, cached, output, cacheWrite },
  };
}

export function formatCredits(value) {
  const number = Number(value) || 0;
  if (number === 0) return "0";
  if (Math.abs(number) < 0.01) return number.toFixed(4);
  return number.toFixed(2);
}

function blankGroup(key, label) {
  return {
    key,
    label,
    credits: 0,
    events: 0,
    tokens: { input: 0, cached: 0, output: 0, cacheWrite: 0 },
  };
}

function addToGroup(group, row) {
  group.credits += Number(row.credits) || 0;
  group.events += 1;
  group.tokens.input += Number(row.input_tokens) || 0;
  group.tokens.cached += Number(row.cached_tokens) || 0;
  group.tokens.output += Number(row.output_tokens) || 0;
  group.tokens.cacheWrite += Number(row.cache_write_tokens) || 0;
}

function grouped(rows, keyFor, labelFor) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFor(row);
    const group = map.get(key) ?? blankGroup(key, labelFor(row));
    addToGroup(group, row);
    map.set(key, group);
  }
  return [...map.values()].sort((a, b) => b.credits - a.credits);
}

export function recordCost(cwd = process.cwd(), entry = {}, options = {}) {
  const env = options.env ?? process.env;
  const usage = entry.usage ?? entry;
  const model = entry.model ?? "unknown";
  const calc = creditsFor(model, usage);
  const project = projectIdentity(cwd, env);
  const db = openContextDb(options.dbPath ?? contextDbPath(env));
  try {
    db.prepare(
      `INSERT INTO cost_events (
        project_id, session_id, task_id, task_title, role, source, model,
        input_tokens, cached_tokens, output_tokens, cache_write_tokens,
        credits, known_rates, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      project.id,
      entry.sessionId ?? null,
      entry.taskId ?? null,
      entry.taskTitle ?? null,
      entry.role ?? "orchestrator",
      entry.source ?? "chat",
      calc.model,
      calc.tokens.input,
      calc.tokens.cached,
      calc.tokens.output,
      calc.tokens.cacheWrite,
      calc.credits,
      calc.known ? 1 : 0,
      entry.createdAt ?? nowIso(),
    );
  } finally {
    db.close();
  }
  return { ...calc, projectId: project.id, sessionId: entry.sessionId ?? null };
}

export function costSummary(options = {}) {
  const env = options.env ?? process.env;
  const dbPath = options.dbPath ?? contextDbPath(env);
  const empty = {
    events: 0,
    credits: 0,
    tokens: { input: 0, cached: 0, output: 0, cacheWrite: 0 },
    unknownModels: 0,
    byModel: [],
    byTask: [],
    byRole: [],
    byProject: [],
  };

  let db;
  try {
    db = openContextDb(dbPath);
  } catch {
    return empty;
  }

  try {
    const clauses = [];
    const params = [];
    if (options.projectId) {
      clauses.push("project_id = ?");
      params.push(options.projectId);
    }
    if (options.taskId) {
      clauses.push("task_id = ?");
      params.push(options.taskId);
    }
    if (options.sessionId) {
      clauses.push("session_id = ?");
      params.push(options.sessionId);
    }
    if (options.model) {
      clauses.push("model = ?");
      params.push(normalizeModel(options.model));
    }
    if (options.days) {
      const since = new Date(Date.now() - Number(options.days) * 86_400_000).toISOString();
      clauses.push("created_at >= ?");
      params.push(since);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = db
      .prepare(`SELECT * FROM cost_events ${where} ORDER BY id DESC LIMIT ?`)
      .all(...params, Math.max(1, Number(options.maxEvents) || 10_000));

    if (!rows.length) return empty;

    const summary = { ...empty, events: rows.length };
    for (const row of rows) {
      summary.credits += Number(row.credits) || 0;
      summary.tokens.input += Number(row.input_tokens) || 0;
      summary.tokens.cached += Number(row.cached_tokens) || 0;
      summary.tokens.output += Number(row.output_tokens) || 0;
      summary.tokens.cacheWrite += Number(row.cache_write_tokens) || 0;
      if (!row.known_rates) summary.unknownModels += 1;
    }
    summary.byModel = grouped(rows, (row) => row.model, (row) => row.model);
    summary.byTask = grouped(
      rows,
      (row) => row.task_id ?? "(sin tarea)",
      (row) => row.task_title ?? row.task_id ?? "(sin tarea)",
    );
    summary.byRole = grouped(rows, (row) => row.role, (row) => row.role);
    summary.byProject = grouped(rows, (row) => row.project_id, (row) => row.project_id);
    return summary;
  } catch {
    return empty;
  } finally {
    db.close();
  }
}
