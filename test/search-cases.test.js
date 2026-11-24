import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { searchContext } from "../src/context.js";
import { init, saveMemory } from "../src/kernel.js";

process.env.PO_SHELL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "po-shell-search-home-"));

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "po-shell-search-"));
  const env = {
    PO_SHELL_HOME: process.env.PO_SHELL_HOME,
    PO_SHELL_CONTEXT_DB: path.join(dir, "context.db"),
    PO_SHELL_SEMANTIC: "off",
  };
  init(dir, env);
  return { dir, env };
}

async function search(dir, env, query, options = {}) {
  return searchContext(dir, query, {
    env,
    semantic: false,
    kinds: ["memory"],
    limit: 5,
    ...options,
  });
}

test("FTS: plural query finds singular memory", async () => {
  const { dir, env } = project();
  saveMemory(
    dir,
    {
      title: "Coupon expiry timezone bug",
      what: "Un cupón vencido se aplicaba por timezone.",
      why: "La fecha se comparaba mal.",
      learned: "Normalizar a UTC.",
      aliases: "cupon vencido, expiry, timezone",
      topic: "lesson/coupon-expiry",
      type: "lesson",
    },
    env,
  );

  const result = await search(dir, env, "cupones vencidos");
  assert.equal(result.results[0].id, "mem:lesson-coupon-expiry");
});

test("FTS: accented query finds unaccented content", async () => {
  const { dir, env } = project();
  saveMemory(
    dir,
    {
      title: "Idempotencia de uploads",
      what: "Reusar el request id en cada reintento.",
      why: "Los retries duplicaban.",
      learned: "El id es estable.",
      topic: "lesson/upload-idempotency",
      type: "lesson",
    },
    env,
  );

  const result = await search(dir, env, "idempotência");
  assert.equal(result.results[0].id, "mem:lesson-upload-idempotency");
});

test("FTS: bilingual alias finds memory across languages", async () => {
  const { dir, env } = project();
  saveMemory(
    dir,
    {
      title: "Use pnpm for dependencies",
      what: "Usar pnpm para instalar dependencias.",
      why: "El lockfile es pnpm-lock.yaml.",
      learned: "No mezclar npm install.",
      aliases: "gestor de paquetes, package manager, install",
      topic: "behavior/pnpm",
      type: "behavior",
    },
    env,
  );

  const result = await search(dir, env, "package manager");
  assert.equal(result.results[0].id, "mem:behavior-pnpm");
});

test("FTS: OR fallback finds a partial multi-term match", async () => {
  const { dir, env } = project();
  saveMemory(
    dir,
    {
      title: "Cache invalidation on profile updates",
      what: "Invalidate the profile cache after an update.",
      why: "Users saw stale data.",
      learned: "Cache keys are scoped by user id.",
      aliases: "invalidacion de cache, perfil, stale data",
      topic: "lesson/profile-cache",
      type: "lesson",
    },
    env,
  );

  const result = await search(dir, env, "cache perfil inexistente");
  assert.equal(result.results[0].id, "mem:lesson-profile-cache");
});

test("FTS: unknown query returns no results", async () => {
  const { dir, env } = project();
  saveMemory(
    dir,
    {
      title: "Known memory",
      what: "Contenido conocido.",
      topic: "lesson/known",
      type: "lesson",
    },
    env,
  );

  const result = await search(dir, env, "kubernetes deployment");
  assert.deepEqual(result.results, []);
});
