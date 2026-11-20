import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { indexProject, isIndexableSection, openContextDb, splitSections } from "../src/indexer.js";
import { init, plainPath, saveMemory } from "../src/kernel.js";

process.env.PLAIN_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "plain-index-home-"));

function tempProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plain-index-"));
  fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
  return dir;
}

function runIndex(dir, options = {}) {
  return indexProject(dir, {
    env: {
      PLAIN_HOME: process.env.PLAIN_HOME,
      PLAIN_CONTEXT_DB: path.join(dir, "context.db"),
    },
    ...options,
  });
}

function writeDoc(dir, name, body) {
  const file = path.join(dir, "docs", name);
  fs.writeFileSync(file, body);
  return file;
}

test("splitSections ignores headings inside fenced code", () => {
  const sections = splitSections(
    [
      "# Requirements",
      "",
      "## Idempotencia",
      "",
      "El upload debe ser idempotente.",
      "",
      "```sh",
      "# esto no es un heading",
      "```",
      "",
      "## Auth",
      "",
      "Cookies.",
    ].join("\n"),
  );
  assert.equal(sections.length, 3);
  assert.deepEqual(
    sections.map((section) => section.breadcrumb),
    ["Requirements", "Requirements > Idempotencia", "Requirements > Auth"],
  );
});

test("indexes docs by heading and reindexes only changes", () => {
  const dir = tempProject();
  writeDoc(
    dir,
    "requirements.md",
    "# Requirements\n\n## Idempotencia\n\nEl upload debe ser idempotente.\n\n## Auth\n\nCookies.\n",
  );

  const first = runIndex(dir);
  assert.equal(first.docs.files, 1);
  assert.equal(first.docs.chunks, 3);
  assert.equal(first.docs.updatedFiles, 1);
  assert.equal(first.memories.total, 0);

  const second = runIndex(dir);
  assert.equal(second.docs.updatedFiles, 0);
  assert.equal(second.docs.unchangedFiles, 1);

  writeDoc(
    dir,
    "requirements.md",
    "# Requirements\n\n## Idempotencia\n\nEl upload debe ser idempotente y seguro.\n\n## Auth\n\nCookies.\n",
  );
  const third = runIndex(dir);
  assert.equal(third.docs.updatedFiles, 1);
  assert.equal(third.docs.unchangedFiles, 0);
  assert.equal(third.docs.chunks, 3);
});

test("indexes memories and exposes them through FTS", () => {
  const dir = tempProject();
  init(dir);
  saveMemory(dir, {
    title: "Idempotencia",
    what: "Reusar request id",
    why: "Los retries duplicaban",
    where: "upload.go",
    learned: "El id es estable",
    topic: "arch/upload",
  });

  const result = runIndex(dir);
  assert.equal(result.memories.total, 1);
  assert.equal(result.memories.updated, 1);

  const db = openContextDb(path.join(dir, "context.db"));
  const rows = db
    .prepare("SELECT title FROM memories_fts WHERE memories_fts MATCH ?")
    .all("duplicaban");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "Idempotencia");
  db.close();
});

test("removes docs that no longer exist and rebuilds on demand", () => {
  const dir = tempProject();
  const file = writeDoc(dir, "temporal.md", "# Temporal\n\nContenido.\n");
  assert.equal(runIndex(dir).docs.files, 1);

  fs.rmSync(file);
  const removed = runIndex(dir);
  assert.equal(removed.docs.files, 0);
  assert.equal(removed.docs.removedFiles, 1);

  const rebuilt = runIndex(dir, { rebuild: true });
  assert.equal(rebuilt.docs.files, 0);
  assert.equal(rebuilt.docs.chunks, 0);
});


test("skips mutable feature sections from the index", () => {
  const dir = tempProject();
  fs.mkdirSync(path.join(dir, "docs", "features"), { recursive: true });
  writeDoc(
    dir,
    "features/discounts.md",
    [
      "# Feature: descuentos",
      "",
      "## Resultado",
      "",
      "El usuario ve el descuento.",
      "",
      "## Specs",
      "",
      "R1. Aplicar cupón.",
      "",
      "## Tasks",
      "",
      "- [ ] T1. Implementar.",
      "",
      "## Estado",
      "",
      "Task activa: T1.",
      "",
      "## Log",
      "",
      "L1. Pedido original.",
      "",
    ].join("\n"),
  );

  const result = runIndex(dir);
  assert.equal(result.docs.chunks, 3);
  const db = openContextDb(path.join(dir, "context.db"));
  const headings = db.prepare("SELECT heading FROM doc_chunks ORDER BY id").all().map((row) => row.heading);
  assert.deepEqual(headings, ["Feature: descuentos", "Resultado", "Specs"]);
  assert.ok(!headings.includes("Tasks"));
  assert.ok(!headings.includes("Estado"));
  assert.ok(!headings.includes("Log"));
  db.close();
});

test("isIndexableSection rejects mutable headings and their children", () => {
  assert.equal(isIndexableSection({ breadcrumb: "Feature > Specs" }), true);
  assert.equal(isIndexableSection({ breadcrumb: "Feature > Tasks" }), false);
  assert.equal(isIndexableSection({ breadcrumb: "Feature > Tasks > T1" }), false);
  assert.equal(isIndexableSection({ breadcrumb: "Feature > Estado actual" }), false);
});


test("indexes bilingual memory aliases for exact FTS search", () => {
  const dir = tempProject();
  init(dir);
  saveMemory(dir, {
    title: "Upload idempotency",
    what: "Reuse the request id for uploads.",
    why: "Retries duplicated records.",
    where: "internal/upload/handler.go",
    learned: "The request id is stable across retries.",
    aliases: "idempotencia, reintentos",
  });
  runIndex(dir);
  const db = openContextDb(path.join(dir, "context.db"));
  const rows = db
    .prepare("SELECT title FROM memories_fts WHERE memories_fts MATCH ?")
    .all("idempotencia");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "Upload idempotency");
  db.close();
});


test("imports legacy Markdown memories when the database is empty", () => {
  const dir = tempProject();
  init(dir);
  const file = path.join(plainPath(dir), "memory", "legacy-upload.md");
  fs.writeFileSync(
    file,
    "# Legacy upload\n\n- type: decision\n- aliases: idempotencia\n\n## What\nReuse the id.\n",
  );
  const result = runIndex(dir);
  assert.equal(result.memories.total, 1);
  assert.equal(result.memories.updated, 1);
  const db = openContextDb(path.join(dir, "context.db"));
  const row = db.prepare("SELECT title FROM memories WHERE memory_key = ?").get("legacy-upload");
  assert.equal(row.title, "Legacy upload");
  db.close();
});


test("rebuild preserves canonical memories", () => {
  const dir = tempProject();
  const env = {
    PLAIN_HOME: process.env.PLAIN_HOME,
    PLAIN_CONTEXT_DB: path.join(dir, "context.db"),
  };
  init(dir, env);
  saveMemory(
    dir,
    {
      title: "Canonical memory",
      what: "Must survive a docs rebuild.",
      topic: "lesson/canonical",
      type: "lesson",
    },
    env,
  );
  runIndex(dir, { rebuild: true });
  const db = openContextDb(path.join(dir, "context.db"));
  const row = db.prepare("SELECT title FROM memories WHERE memory_key = ?").get("lesson-canonical");
  assert.equal(row.title, "Canonical memory");
  db.close();
});
