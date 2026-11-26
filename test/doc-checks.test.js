import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MAX_DOC_LINES, checkDocs, formatProblems } from "../src/doc-checks.js";

function repo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "po-shell-docs-"));
}

function write(dir, rel, body) {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  return file;
}

const messages = (dir) => checkDocs(dir).problems.map((item) => item.message);

test("a reference to a missing file is a problem; an existing one is not", () => {
  const dir = repo();
  write(dir, "PROJECT.md", "# p\n\nVer [guía](docs/guide.md) y `docs/missing.md`.\n");
  write(dir, "docs/guide.md", "# guía\n");
  const problems = checkDocs(dir).problems;
  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /docs\/missing\.md/);
  assert.equal(problems[0].line, 3);
});

test("bare file names in inline code are not pointers", () => {
  const dir = repo();
  write(dir, "skills/x/SKILL.md", "No crees `brief.md` ni `spec.md` sueltos.\n");
  assert.deepEqual(messages(dir), []);
});

test("a feature doc carries type and status, and no state of its own", () => {
  const dir = repo();
  write(dir, "docs/features/ok.md", "---\ntype: feature\nstatus: active\n---\n\n# Feature\n\n## Design\n");
  assert.deepEqual(messages(dir), []);

  write(dir, "docs/features/sin-frontmatter.md", "# Feature\n");
  write(dir, "docs/features/con-estado.md", "---\ntype: feature\nstatus: done\n---\n\n## State\n\nen curso\n");
  const problems = messages(dir);
  assert.ok(problems.some((m) => /without frontmatter/.test(m)));
  assert.ok(problems.some((m) => /"## State" does not belong/.test(m)));
});

test("a decision nobody implements is reported", () => {
  const dir = repo();
  write(
    dir,
    "docs/features/d.md",
    "---\ntype: feature\nstatus: active\n---\n\n## Decisions\n\n- D1 — con unidad\n- D2 — sin unidad\n\n## Units\n\n- [ ] U1 — algo (D1)\n",
  );
  const problems = messages(dir);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /decision D2 is not referenced/);
});

test("PROJECT.md and AGENTS.md have a ceiling", () => {
  const dir = repo();
  write(dir, "PROJECT.md", `${"linea\n".repeat(MAX_DOC_LINES + 1)}`);
  write(dir, "AGENTS.md", "# ok\n");
  write(dir, "docs/notas.md", `${"linea\n".repeat(MAX_DOC_LINES + 50)}`);
  const problems = messages(dir);
  assert.equal(problems.length, 1, "only the two project docs are bounded");
  assert.match(problems[0], new RegExp(`over the ${MAX_DOC_LINES}-line ceiling`));
});

test("formatProblems is readable and empty when everything is fine", () => {
  assert.deepEqual(formatProblems([]), []);
  const lines = formatProblems([{ file: "a.md", line: 3, message: "roto" }, { file: "b.md", line: null, message: "sin nadie" }]);
  assert.equal(lines[0], "a.md:3 — roto");
  assert.equal(lines[1], "b.md — sin nadie");
  assert.equal(lines.at(-1), "2 problem(s) in the documentation.");
});
