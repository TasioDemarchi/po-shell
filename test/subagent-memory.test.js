import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { memorySearch } from "../src/subagent-memory.js";
import { indexProject } from "../src/indexer.js";
import { projectIdentity } from "../src/project.js";
import { init, saveMemory } from "../src/kernel.js";

// Same fixture style as test/context.test.js: a temp home and temp projects,
// all of it removed at the end.
process.env.PO_SHELL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "po-shell-subagent-memory-home-"));
delete process.env.PO_SHELL_CONTEXT_DB;

const created = [process.env.PO_SHELL_HOME];

after(() => {
  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.PO_SHELL_CONTEXT_DB;
});

function tempDir(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `po-shell-subagent-memory-${label}-`));
  created.push(dir);
  return dir;
}

function tempProject(label) {
  const dir = tempDir(label);
  fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
  fs.writeFileSync(path.join(dir, "docs", "notes.md"), "# Notes\n\n## Upload\n\nEl upload es idempotente.\n");
  init(dir);
  return dir;
}

test("an empty query returns no results instead of running an empty MATCH", () => {
  const dir = tempProject("empty");
  saveMemory(dir, { title: "Zebra striping", what: "Las filas pares llevan fondo.", topic: "arch/zebra" });

  for (const query of ["", "   ", "--", undefined]) {
    const { results } = memorySearch(dir, { query });
    assert.deepEqual(results, [], `query ${JSON.stringify(query)} must not match anything`);
  }
  // The same project does answer when the term exists: the empty case is a miss, not a broken index.
  assert.equal(memorySearch(dir, { query: "zebra" }).results.length, 1);
});

test("limit clamps to 1..10 and defaults to 5", () => {
  const dir = tempProject("limit");
  for (let i = 1; i <= 12; i += 1) {
    saveMemory(dir, {
      title: `Pelican rule ${i}`,
      what: `El pelican ${i} se normaliza antes de guardarse.`,
      topic: `lesson/pelican-${i}`,
    });
  }
  const count = (limit) => memorySearch(dir, { query: "pelican", limit }).results.length;
  assert.equal(count(undefined), 5, "default is 5");
  assert.equal(count(0), 1, "0 clamps up to 1, it is not 'everything'");
  assert.equal(count(1), 1);
  assert.equal(count(10), 10);
  assert.equal(count(99), 10, "99 clamps down to 10");
  assert.equal(count(-3), 1);
});

test("results are compact: type, title, snippet and the key, never the body", () => {
  const dir = tempProject("compact");
  saveMemory(dir, {
    title: "Idempotencia",
    what: "Reusar request id en cada reintento.",
    why: "Los retries duplicaban el registro en la base.",
    where: "upload.go",
    learned: "El id es estable si se genera antes del envío.",
    topic: "arch/upload",
  });

  const { results } = memorySearch(dir, { query: "reintento", limit: 5 });
  assert.equal(results.length, 1);
  const [result] = results;
  assert.deepEqual(Object.keys(result).sort(), ["key", "snippet", "title", "type"]);
  assert.equal(result.key, "arch-upload");
  assert.equal(result.type, "memory");
  assert.equal(result.title, "Idempotencia");
  assert.equal(typeof result.snippet, "string");
  assert.ok(result.snippet.length > 0 && result.snippet.length <= 260);
  assert.equal("content" in result, false, "a child never gets the full body");
});

test("another project's memory is never returned, even when it is the only match", () => {
  const here = tempProject("here");
  const other = tempProject("other");
  assert.notEqual(projectIdentity(here).id, projectIdentity(other).id, "two distinct projects");

  saveMemory(other, {
    title: "Quokka deploy notes",
    what: "El quokka se despliega los martes en la madrugada.",
    topic: "ops/quokka",
  });
  // One DB, both projects indexed: the scoping is SQL, not an accident of the fixture.
  indexProject(other);

  const missed = memorySearch(here, { query: "quokka" });
  assert.deepEqual(missed.results, [], "the only hit lives in the other project, so there is no hit");

  saveMemory(here, {
    title: "Heron local rule",
    what: "El heron se valida en el borde del proyecto.",
    topic: "arch/heron",
  });
  saveMemory(other, {
    title: "Heron foreign rule",
    what: "El heron de otro proyecto no se filtra al hijo.",
    topic: "arch/heron",
  });
  const scoped = memorySearch(here, { query: "heron" }).results;
  assert.equal(scoped.length, 1, "both projects match, only this one comes back");
  assert.equal(scoped[0].title, "Heron local rule");

  const fromOther = memorySearch(other, { query: "heron" }).results;
  assert.equal(fromOther.length, 1);
  assert.equal(fromOther[0].title, "Heron foreign rule");
});

test("no project or no DB means no results, and nothing is created", () => {
  const loose = tempDir("loose");
  assert.deepEqual(memorySearch(loose, { query: "zebra" }).results, [], "a cwd without po-shell state");

  const dir = tempProject("nodb");
  saveMemory(dir, { title: "Zebra missing db", what: "El zebra no se encuentra sin índice.", topic: "arch/zebra" });
  const missing = path.join(tempDir("nodb-db"), "context.db");
  process.env.PO_SHELL_CONTEXT_DB = missing;
  try {
    assert.deepEqual(memorySearch(dir, { query: "zebra" }).results, []);
    assert.equal(fs.existsSync(missing), false, "a read must not create the index");
  } finally {
    delete process.env.PO_SHELL_CONTEXT_DB;
  }
});
