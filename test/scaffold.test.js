import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SCAFFOLD, PLACEHOLDER, ensureProjectDocs, looksUnfilled, templatePath } from "../src/scaffold.js";

function repo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "po-shell-scaffold-"));
}

test("the templates are agent-facing English", () => {
  const project = fs.readFileSync(templatePath("PROJECT.md"), "utf8");
  assert.match(project, /^# Project/m);
  assert.match(project, /^## Goal/m);
  assert.match(project, /^## State/m);
  const agents = fs.readFileSync(templatePath("AGENTS.po-shell.md"), "utf8");
  assert.match(agents, /^## Commands/m);
  assert.ok(looksUnfilled(agents), "a template nobody filled still has placeholders");
});

test("a new repo gets both documents, once", () => {
  const dir = repo();
  const first = ensureProjectDocs(dir);
  assert.deepEqual(first.created.sort(), SCAFFOLD.map((entry) => entry.file).sort());
  assert.ok(fs.existsSync(path.join(dir, "PROJECT.md")));
  assert.ok(fs.existsSync(path.join(dir, "AGENTS.md")));

  const second = ensureProjectDocs(dir);
  assert.deepEqual(second.created, []);
  assert.deepEqual(second.existing.sort(), SCAFFOLD.map((entry) => entry.file).sort());
});

test("an existing document is never overwritten, not even an empty one", () => {
  const dir = repo();
  fs.writeFileSync(path.join(dir, "PROJECT.md"), "# mío\n");
  fs.writeFileSync(path.join(dir, "AGENTS.md"), "");
  const result = ensureProjectDocs(dir);
  assert.deepEqual(result.created, []);
  assert.equal(fs.readFileSync(path.join(dir, "PROJECT.md"), "utf8"), "# mío\n");
  assert.equal(fs.readFileSync(path.join(dir, "AGENTS.md"), "utf8"), "");
});

test("placeholders are detected, real values are not", () => {
  assert.ok(looksUnfilled("test: `<command>`"));
  assert.ok(looksUnfilled("- Build/test: `<the exact commands>`"));
  assert.ok(!looksUnfilled("test: `npm test && npm run check`"));
  assert.ok(!looksUnfilled("## Layout"));
  assert.ok(!looksUnfilled(""));
  assert.ok(PLACEHOLDER.test("`<command>`"));
});
