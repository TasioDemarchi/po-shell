#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { contextDbPath, indexProject } from "../src/indexer.js";
import { getContext, searchContext } from "../src/context.js";

const SKIP = new Set([
  ".git", ".plain", "node_modules", "dist", "build", "target", "vendor",
  "coverage", ".next", ".turbo", ".venv", "venv", "__pycache__",
]);

function walkMd(dir, root, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name)) walkMd(abs, root, out);
    } else if (entry.isFile() && /\.md$/i.test(entry.name)) {
      out.push(abs);
    }
  }
  return out;
}

function readAll(files) {
  let chars = 0;
  for (const file of files) {
    try {
      chars += fs.readFileSync(file, "utf8").length;
    } catch {
      // Ignorar archivos ilegibles.
    }
  }
  return chars;
}

function stats(chars) {
  return {
    chars,
    words: Math.round(chars / 6),
    tokensApprox: Math.ceil(chars / 4),
  };
}

function parseArgs(argv) {
  const out = { query: "idempotencia", limit: 5, getLimit: 2, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") out.json = true;
    else if (arg === "--query") out.query = argv[++i];
    else if (arg === "--limit") out.limit = Number(argv[++i]) || 5;
    else if (arg === "--get-limit") out.getLimit = Number(argv[++i]) || 2;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const cwd = process.cwd();
const env = process.env;
const dbPath = contextDbPath(env);

const started = performance.now();
const indexed = indexProject(cwd, { dbPath, env });
const indexMs = performance.now() - started;
const docs = walkMd(cwd, cwd);
const memoryDir = path.join(cwd, ".plain", "memory");
const memories = fs.existsSync(memoryDir)
  ? fs.readdirSync(memoryDir).filter((name) => name.endsWith(".md")).map((name) => path.join(memoryDir, name))
  : [];

const baselineChars = readAll(docs) + readAll(memories);

const searchStart = performance.now();
const search = searchContext(cwd, args.query, {
  dbPath,
  env,
  autoIndex: false,
  limit: args.limit,
});
const searchMs = performance.now() - searchStart;

const previewChars = search.results.reduce((sum, item) => sum + item.snippet.length, 0);
const gets = [];
let getChars = 0;
const getStart = performance.now();
for (const item of search.results.slice(0, args.getLimit)) {
  const full = getContext(cwd, item.id, { dbPath, env, autoIndex: false });
  gets.push({ id: item.id, kind: item.kind, chars: full.content.length });
  getChars += full.content.length;
}
const getMs = performance.now() - getStart;
const hybridChars = previewChars + getChars;

const report = {
  cwd,
  dbPath,
  query: args.query,
  limit: args.limit,
  getLimit: args.getLimit,
  corpus: {
    docs: docs.length,
    memories: memories.length,
  },
  baseline: stats(baselineChars),
  hybrid: {
    previews: stats(previewChars),
    fullGets: stats(getChars),
    ...stats(hybridChars),
    results: search.results.length,
    gets,
  },
  savings: baselineChars ? 1 - hybridChars / baselineChars : 0,
  latencyMs: {
    index: Number(indexMs.toFixed(1)),
    search: Number(searchMs.toFixed(1)),
    get: Number(getMs.toFixed(1)),
  },
  index: {
    files: indexed.docs.files,
    chunks: indexed.docs.chunks,
    memories: indexed.memories.total,
  },
};

if (args.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Proyecto: ${cwd}`);
  console.log(`Query: ${args.query}`);
  console.log(`Corpus: ${docs.length} docs + ${memories.length} memorias`);
  console.log("");
  console.log(`Baseline (leer todo): ${report.baseline.chars} chars ≈ ${report.baseline.tokensApprox} tokens`);
  console.log(`Hybrid (${search.results.length} previews + ${gets.length} full): ${hybridChars} chars ≈ ${report.hybrid.tokensApprox} tokens`);
  console.log(`Ahorro de contexto: ${(report.savings * 100).toFixed(1)}%`);
  console.log(`Latencia: index ${report.latencyMs.index}ms · search ${report.latencyMs.search}ms · get ${report.latencyMs.get}ms`);
  console.log("");
  for (const item of search.results) {
    console.log(`[${item.kind}] ${item.id} · ${item.kind === "spec" ? item.breadcrumb : item.title}`);
  }
}
