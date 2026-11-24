import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { activeDirectives, getContext, searchContext } from "../src/context.js";
import { globalMemoryIndex, saveMemory } from "../src/kernel.js";

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function envFor(home) {
  return {
    PO_SHELL_HOME: home,
    PO_SHELL_CONTEXT_DB: path.join(home, "context.db"),
  };
}

function behavior(dir, rule, scope, env, extra = {}) {
  return saveMemory(
    dir,
    {
      title: rule,
      what: rule,
      why: "Pedido humano.",
      type: "behavior",
      scope,
      priority: extra.priority ?? "medium",
      trigger: extra.trigger ?? "",
      status: "active",
      topic: extra.topic ?? "",
    },
    env,
  );
}

test("global memories live outside the project and are visible from another project", async () => {
  const home = tempDir("po-shell-home-");
  const projectA = tempDir("po-shell-project-a-");
  const projectB = tempDir("po-shell-project-b-");
  const env = envFor(home);

  const global = behavior(projectA, "Responder en español.", "global", env, {
    topic: "global/language",
  });
  behavior(projectA, "Regla local de A.", "project", env, { topic: "local/a" });

  assert.ok(global.file.startsWith(path.join(home, "memory")));
  assert.ok(!fs.existsSync(path.join(projectA, ".po-shell", "memory", "global-language.md")));
  assert.equal(globalMemoryIndex(env).length, 1);

  const directives = activeDirectives(projectB, { env });
  assert.equal(directives.length, 1);
  assert.equal(directives[0].rule, "Responder en español.");
  assert.equal(directives[0].scope, "global");
  assert.equal(directives[0].id, "mem:global:global-language");
});

test("context_search falls back to global memories with confirmation", async () => {
  const home = tempDir("po-shell-home-");
  const projectA = tempDir("po-shell-project-a-");
  const projectB = tempDir("po-shell-project-b-");
  const env = envFor(home);

  behavior(projectA, "Regla global buscable.", "global", env, { topic: "global/search" });
  behavior(projectA, "Regla local de A.", "project", env, { topic: "local/a" });

  const result = await searchContext(projectB, "buscable", { env });
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].id, "mem:global:global-search");
  assert.equal(result.results[0].scope, "global");
  assert.equal(result.results[0].source, "global");
  assert.equal(result.requiresConfirmation, true);

  const blocked = await searchContext(projectB, "buscable", { env, allowGlobal: false });
  assert.deepEqual(blocked.results, []);
  assert.equal(blocked.requiresConfirmation, true);
  assert.equal(blocked.globalBlocked, true);

  const local = await searchContext(projectB, "local", { env });
  assert.equal(local.results.length, 1);
  assert.equal(local.results[0].source, "other");

  const full = getContext(projectB, result.results[0].id, { env });
  assert.match(full.content, /Regla global buscable/);
  assert.equal(full.id, "mem:global:global-search");
});
