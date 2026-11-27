// A generated code map with inverse dependencies.
//
// Zero dependencies on purpose: the map answers "who imports this, and with
// which names" by scanning the source, not by parsing it with a native binary
// or a network install. This module only renders; `scripts/code-map.mjs` and
// `po-shell map` are the thin CLIs that write and check `docs/code-map.md`.
import fs from "node:fs";
import path from "node:path";

const DIRS = ["src", "extensions", "scripts"];
const SOURCE = /\.(?:js|mjs|ts)$/;
const SKIP_DIRS = new Set(["node_modules"]);
const LINE_LIMIT = 100;

export const MAP_FILE = path.join("docs", "code-map.md");

const EXPORT_DECL = /^export\s+(?:async\s+)?(?:function\s*\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm;
const EXPORT_LIST = /^export\s*\{([\s\S]*?)\}/gm;
const EXPORT_DEFAULT = /^export\s+default\b/gm;
const IMPORT_FROM = /^import\s+([^;]*?)\s+from\s*["']([^"']+)["']/gm;
const IMPORT_BARE = /^import\s*["']([^"']+)["']/gm;

/** Every `.js`, `.mjs` and `.ts` under the three source dirs, repo-relative and posix. */
function walk(root, dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(root, rel, out);
    } else if (entry.isFile() && SOURCE.test(entry.name)) {
      out.push(rel);
    }
  }
  return out;
}

/** `{ a, b as c }` -> the exported names (`a`, `c`). */
function exportListNames(body) {
  const names = [];
  for (const part of body.split(",")) {
    const spec = part.trim().replace(/^type\s+/, "");
    if (!spec) continue;
    const pieces = spec.split(/\s+as\s+/);
    const name = pieces[pieces.length - 1].trim();
    if (/^[A-Za-z_$][\w$]*$/.test(name)) names.push(name);
  }
  return names;
}

/** `fs, { a, b as c }` -> the source names (`default`, `a`, `b`). */
function importClauseNames(clause) {
  const text = clause.trim().replace(/^type\s+/, "");
  const names = [];
  const braces = /\{([\s\S]*?)\}/.exec(text);
  if (braces) {
    for (const part of braces[1].split(",")) {
      const spec = part.trim().replace(/^type\s+/, "");
      if (!spec) continue;
      const name = spec.split(/\s+as\s+/)[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.push(name);
    }
  }
  if (/\*\s+as\s+/.test(text)) names.push("*");
  const head = text.replace(/\{[\s\S]*?\}/, "").replace(/\*\s+as\s+[\w$]+/, "").trim();
  if (/^[A-Za-z_$][\w$]*/.test(head)) names.push("default");
  return names;
}

function analyze(text) {
  const exports = new Set();
  for (const match of text.matchAll(EXPORT_DECL)) exports.add(match[1]);
  for (const match of text.matchAll(EXPORT_LIST)) {
    for (const name of exportListNames(match[1])) exports.add(name);
  }
  if (EXPORT_DEFAULT.test(text)) exports.add("default");

  const imports = [];
  for (const match of text.matchAll(IMPORT_FROM)) {
    const names = importClauseNames(match[1]);
    if (match[2].startsWith(".")) imports.push({ spec: match[2], names });
  }
  for (const match of text.matchAll(IMPORT_BARE)) {
    if (match[1].startsWith(".")) imports.push({ spec: match[1], names: [] });
  }
  return { exports: [...exports], imports };
}

/** `src/a.js` + `../src/b.js` -> `src/b.js`, or null when it escapes the scan. */
function resolveSpec(from, spec) {
  const target = path.posix.normalize(`${path.posix.dirname(from)}/${spec}`);
  return target.startsWith("../") ? null : target;
}

const SORTED = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Packs `{ text, sep }` chunks into lines no longer than `width`. */
function pack(prefix, chunks, width = LINE_LIMIT) {
  const indent = " ".repeat(prefix.length);
  const lines = [];
  let line = prefix;
  let started = false;
  for (const chunk of chunks) {
    const piece = started ? chunk.sep + chunk.text : chunk.text;
    // Keep one column free for the separator that may close this line.
    if (started && line.length + piece.length + 1 > width && line.length > indent.length) {
      lines.push(line + chunk.sep.trimEnd());
      line = indent + chunk.text;
    } else {
      line += piece;
    }
    started = true;
  }
  lines.push(line);
  return lines;
}

function joinable(items, sep = ", ") {
  return items.map((text, index) => ({ text, sep: index ? sep : "" }));
}

function importerChunks(entries) {
  const chunks = [];
  entries.forEach((entry, index) => {
    chunks.push({ text: entry.path, sep: index ? ", " : "" });
    if (!entry.names.length) return;
    chunks.push({ text: "(", sep: " " });
    entry.names.forEach((name, nameIndex) => {
      const last = nameIndex === entry.names.length - 1;
      chunks.push({ text: last ? `${name})` : name, sep: nameIndex ? ", " : "" });
    });
  });
  return chunks;
}

/** The code map for the repo at `root`: `text` plus the two counts its header shows. */
export function buildMap(root = process.cwd()) {
  const base = path.resolve(root);
  const files = [];
  for (const dir of DIRS) walk(base, dir, files);
  files.sort(SORTED);
  const known = new Set(files);

  const parsed = new Map();
  for (const rel of files) {
    parsed.set(rel, analyze(fs.readFileSync(path.join(base, rel), "utf8")));
  }

  // Inverse dependencies: target -> importer -> the names it imports.
  const importers = new Map();
  const edges = new Set();
  for (const rel of files) {
    for (const item of parsed.get(rel).imports) {
      const target = resolveSpec(rel, item.spec);
      if (!target || target === rel || !known.has(target)) continue;
      edges.add(`${rel} -> ${target}`);
      if (!importers.has(target)) importers.set(target, new Map());
      const byImporter = importers.get(target);
      if (!byImporter.has(rel)) byImporter.set(rel, new Set());
      for (const name of item.names) byImporter.get(rel).add(name);
    }
  }

  const out = [
    "---",
    "type: map",
    "generated: true",
    "---",
    "",
    `# code map · ${files.length} files · ${edges.size} import edges`,
    "",
    "Generated by `npm run code:map`; checked by `npm test`. Do not edit by hand.",
    "",
  ];

  for (const rel of files) {
    const exports = [...new Set(parsed.get(rel).exports)].sort(SORTED);
    const entries = [...(importers.get(rel) ?? new Map())]
      .map(([from, names]) => ({ path: from, names: [...names].sort(SORTED) }))
      .sort((a, b) => SORTED(a.path, b.path));
    if (!exports.length && !entries.length) continue;

    out.push(`## ${rel}`, "");
    if (exports.length) out.push(...pack("- exports: ", joinable(exports)));
    if (entries.length) out.push(...pack("- imported by: ", importerChunks(entries)));
    out.push("");
  }

  return { text: `${out.join("\n").trimEnd()}\n`, files: files.length, edges: edges.size };
}

/** The code map for the repo at `root`, as the markdown text of `docs/code-map.md`. */
export function renderMap(root = process.cwd()) {
  return buildMap(root).text;
}

/** The first line that differs between the expected and the committed map. */
export function firstDifference(expected, actual) {
  const want = expected.split("\n");
  const got = actual.split("\n");
  const total = Math.max(want.length, got.length);
  for (let index = 0; index < total; index += 1) {
    if (want[index] !== got[index]) {
      return { line: index + 1, expected: want[index] ?? "(end of file)", actual: got[index] ?? "(end of file)" };
    }
  }
  return null;
}
