// The two documents the agent needs before it can work in a repo.
//
// Nobody should have to ask for them: a new project gets a skeleton on the first
// run, in English (agent-facing), and never gets an existing file overwritten. The
// human does not need to know they exist; the agent fills them as it learns the
// project.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const SCAFFOLD = [
  { file: "PROJECT.md", template: "PROJECT.md" },
  { file: "AGENTS.md", template: "AGENTS.po-shell.md" },
];

/** The placeholders a template ships with: a scaffold nobody filled still lies. */
export const PLACEHOLDER = /`<[a-z][^`>]{0,40}>`/;

export function templatePath(name) {
  return path.join(PACKAGE_ROOT, "templates", name);
}

/** A scaffold that still carries placeholders is a skeleton, not an answer. */
export function looksUnfilled(text) {
  return PLACEHOLDER.test(String(text ?? ""));
}

/**
 * Create the missing documents. Idempotent: an existing file is left alone, even an
 * empty one — deciding to delete it is the human's, not ours.
 */
export function ensureProjectDocs(cwd = process.cwd(), options = {}) {
  const root = path.resolve(cwd);
  const created = [];
  const existing = [];
  for (const entry of SCAFFOLD) {
    const target = path.join(root, entry.file);
    if (fs.existsSync(target)) {
      existing.push(entry.file);
      continue;
    }
    try {
      fs.copyFileSync(templatePath(entry.template), target);
      created.push(entry.file);
    } catch {
      // A read-only checkout must not break init: the agent can still work.
    }
  }
  return { created, existing, skipped: options.skip === true };
}
