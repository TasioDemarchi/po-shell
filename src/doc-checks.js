// Document consistency, the part tests never see.
//
// A test proves the code works; it does not notice that `docs/status.md` was
// deleted while three files still link to it, that a feature doc carries a
// `## State` section that contradicts the model, or that a decision nobody
// implements is sitting in the doc. Those are mechanical, so they are checked.

import fs from "node:fs";
import path from "node:path";
import { orphanDecisions } from "./decisions.js";

export const MAX_DOC_LINES = 200;

// Debt the new rule found on documents written before it. A ratchet: every entry
// names the file and the problem, and it disappears when the file is fixed. The
// list only shrinks, which is the point — new violations are never added here.
export const KNOWN_DEBT = [
  // U9: split it, do not compress it until it is ambiguous.
  "AGENTS.md — 223 lines, over the 200-line ceiling",
  "docs/features/instalador-propio.md — \"## State\" does not belong in a feature doc",
  "docs/features/instalador-propio.md — \"## Log\" does not belong in a feature doc",
  "docs/features/tui-status.md — \"## State\" does not belong in a feature doc",
  "docs/features/tui-status.md — \"## Log\" does not belong in a feature doc",
];

function isKnown(problem) {
  return KNOWN_DEBT.some((entry) => entry.startsWith(`${problem.file} — ${problem.message.slice(0, 40)}`));
}
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "coverage", "vendor"]);
const MUTABLE_FEATURE_HEADINGS = /^##\s+(state|log|logbook|estado|bitácora|bitacora|changelog)\s*$/i;
// Links always point somewhere. Inline spans only when they name a path: `SKILL.md`
// or `brief.md` are file names being discussed, not pointers.
const LINK = /\]\(([^)\s]+\.md)\)/g;
const PATH_SPAN = /`([\w.-]+\/[\w./-]+\.md)`/g;
const FRONTMATTER = /^---\n([\s\S]*?)\n---\n/;

function walk(root, dir = root, out = []) {
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
      walk(root, abs, out);
      continue;
    }
    if (entry.isFile() && /\.md$/i.test(entry.name)) out.push(abs);
  }
  return out;
}

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

/**
 * `{ problems: [{ file, line, message }], checked }`.
 * `file` is repo-relative: the output is read by a human, not by a path resolver.
 */
export function checkDocs(cwd = process.cwd()) {
  const root = path.resolve(cwd);
  const files = walk(root);
  const problems = [];
  const add = (file, message, line) => problems.push({ file, line: line ?? null, message });

  for (const absolute of files) {
    const rel = path.relative(root, absolute).replace(/\\/g, "/");
    const text = fs.readFileSync(absolute, "utf8");

    // Every `.md` reference must point at a file that exists.
    for (const pattern of [LINK, PATH_SPAN]) {
      for (const match of text.matchAll(pattern)) {
        const target = String(match[1] ?? "").replace(/^<|>$/g, "");
        if (!target || /^https?:/i.test(target) || target.startsWith("#")) continue;
        if (!fs.existsSync(path.resolve(root, target))) {
          add(rel, `reference to a file that does not exist: ${target}`, lineOf(text, match.index ?? 0));
        }
      }
    }

    const lines = text.split("\n").length;
    if ((rel === "PROJECT.md" || rel === "AGENTS.md") && lines > MAX_DOC_LINES) {
      add(rel, `${lines} lines, over the ${MAX_DOC_LINES}-line ceiling`);
    }

    if (!rel.startsWith("docs/features/")) continue;

    // A feature doc describes a slice: type and status, nothing else required.
    const front = FRONTMATTER.exec(text);
    if (!front) {
      add(rel, "feature doc without frontmatter (`type` and `status` are required)");
    } else {
      if (!/^type:\s*\S+/m.test(front[1])) add(rel, "feature doc without `type`");
      if (!/^status:\s*\S+/m.test(front[1])) add(rel, "feature doc without `status`");
    }

    // State lives in the kernel and the project doc, never here.
    text.split("\n").forEach((line, index) => {
      if (MUTABLE_FEATURE_HEADINGS.test(line)) {
        add(rel, `"${line.trim()}" does not belong in a feature doc: state lives in the task and PROJECT.md`, index + 1);
      }
    });

    // A decision nobody implements is either pending or forgotten.
    for (const id of orphanDecisions(text)) {
      add(rel, `decision ${id} is not referenced by any unit`);
    }
  }

  const known = problems.filter(isKnown);
  return { problems: problems.filter((item) => !isKnown(item)), known, checked: files.length };
}

/** `problems` as the lines a human reads, plus a count. */
export function formatProblems(problems) {
  if (!problems.length) return [];
  return [
    ...problems.map((item) => `${item.file}${item.line ? `:${item.line}` : ""} — ${item.message}`),
    "",
    `${problems.length} problem(s) in the documentation.`,
  ];
}
