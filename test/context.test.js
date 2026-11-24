import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getContext, searchContext, toFtsQuery, toFtsQueryAny } from "../src/context.js";
import { init, saveMemory } from "../src/kernel.js";

process.env.PO_SHELL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "po-shell-context-home-"));

function tempProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "po-shell-context-"));
  fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "docs", "requirements.md"),
    "# Requirements\n\n## Upload\n\nEl upload debe ser idempotente.\n\n## Auth\n\nUsar cookies.\n",
  );
  init(dir);
  saveMemory(dir, {
    title: "Idempotencia",
    what: "Reusar request id",
    why: "Los retries duplicaban",
    where: "upload.go",
    learned: "El id es estable",
    topic: "arch/upload",
  });
  return dir;
}

function envFor(dir) {
  return {
    PO_SHELL_HOME: process.env.PO_SHELL_HOME,
    PO_SHELL_CONTEXT_DB: path.join(dir, "context.db"),
  };
}

test("toFtsQuery quotes terms and ignores empty input", async () => {
  assert.equal(toFtsQuery("retry duplicado"), '"retry" AND "duplicado"');
  assert.equal(toFtsQuery("--"), null);
  assert.equal(toFtsQuery(""), null);
});

test("toFtsQuery expands plural variants and filters stopwords in OR fallback", async () => {
  assert.equal(
    toFtsQuery("cupones vencidos"),
    '("cupones" OR "cupon") AND ("vencidos" OR "vencido")',
  );
  assert.equal(
    toFtsQueryAny("cupones vencidos"),
    '"cupones" OR "cupon" OR "vencidos" OR "vencido"',
  );
  assert.equal(
    toFtsQueryAny("cómo evitamos que una empresa vea los datos de otra"),
    '"evitamos" OR "evitamo" OR "empresa" OR "vea" OR "datos" OR "dato"',
  );
});

test("searches specs and memories in one query", async () => {
  const dir = tempProject();
  const result = await searchContext(dir, "upload", { env: envFor(dir) });
  assert.ok(result.results.length >= 2);
  const kinds = new Set(result.results.map((item) => item.kind));
  assert.ok(kinds.has("spec"));
  assert.ok(kinds.has("memory"));
});

test("filters by kind and fetches a spec section", async () => {
  const dir = tempProject();
  const memories = await searchContext(dir, "duplicaban", {
    env: envFor(dir),
    kinds: ["memory"],
  });
  assert.equal(memories.results.length, 1);
  assert.equal(memories.results[0].kind, "memory");

  const specs = await searchContext(dir, "idempotente", {
    env: envFor(dir),
    kinds: ["spec"],
  });
  assert.equal(specs.results.length, 1);
  const section = getContext(dir, specs.results[0].id, { env: envFor(dir) });
  assert.equal(section.kind, "spec");
  assert.match(section.content, /idempotente/);
  assert.ok(section.lineStart >= 1);
});

test("fetches a memory by stable id", async () => {
  const dir = tempProject();
  const result = await searchContext(dir, "duplicaban", { env: envFor(dir) });
  const memory = result.results.find((item) => item.kind === "memory");
  assert.ok(memory);
  const item = getContext(dir, memory.id, { env: envFor(dir) });
  assert.equal(item.kind, "memory");
  assert.match(item.content, /Los retries duplicaban/);
  assert.equal(item.type, "memory");
});

test("returns no results for an unknown term", async () => {
  const dir = tempProject();
  const result = await searchContext(dir, "palabraquenoexiste", { env: envFor(dir) });
  assert.deepEqual(result.results, []);
});


test("FTS fallback finds singular memory from plural query", async () => {
  const dir = tempProject();
  saveMemory(dir, {
    title: "Coupon expiry timezone bug",
    what: "Un cupón vencido se aplicaba por timezone.",
    why: "La fecha se comparaba mal.",
    learned: "Normalizar a UTC.",
    aliases: "cupon vencido, expiry, timezone",
    topic: "lesson/coupon-expiry",
  });
  const result = await searchContext(dir, "cupones vencidos", {
    env: envFor(dir),
    semantic: false,
    kinds: ["memory"],
  });
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].id, "mem:lesson-coupon-expiry");
});
