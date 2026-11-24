import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { activeDirectives } from "../src/context.js";
import { init, saveMemory } from "../src/kernel.js";

function envFor(dir) {
  return {
    PO_SHELL_HOME: path.join(dir, "home"),
    PO_SHELL_CONTEXT_DB: path.join(dir, "context.db"),
  };
}

function tempProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "po-shell-directives-"));
  const env = envFor(dir);
  init(dir, env);
  return { dir, env };
}

function remember(dir, rule, options = {}, env = envFor(dir)) {
  return saveMemory(dir, {
    title: options.title ?? rule,
    what: rule,
    why: "Pedido humano.",
    topic: options.topic ?? "",
    type: "behavior",
    scope: options.scope ?? "project",
    priority: options.priority ?? "medium",
    trigger: options.trigger ?? "",
    status: options.status ?? "active",
  }, env);
}

test("stores behavior directives and injects the rule", () => {
  const { dir, env } = tempProject();
  remember(dir, "Antes de refactorizar, mostrar un plan.", {
    scope: "global",
    priority: "high",
    trigger: "refactor, renombrar",
  });

  const directives = activeDirectives(dir, { env });
  assert.equal(directives.length, 1);
  assert.equal(directives[0].rule, "Antes de refactorizar, mostrar un plan.");
  assert.equal(directives[0].scope, "global");
  assert.equal(directives[0].priority, "high");
  assert.equal(directives[0].trigger, "refactor, renombrar");
});

test("project scope wins over global and superseded directives are excluded", () => {
  const { dir, env } = tempProject();
  remember(dir, "Regla global.", { scope: "global", priority: "high", topic: "behavior/global" }, env);
  remember(dir, "Regla de proyecto.", { scope: "project", priority: "medium", topic: "behavior/project" }, env);
  remember(dir, "Regla vieja.", { scope: "global", priority: "high", status: "superseded", topic: "behavior/old" }, env);

  const directives = activeDirectives(dir, { env });
  assert.equal(directives.length, 2);
  assert.equal(directives[0].scope, "project");
  assert.equal(directives[0].rule, "Regla de proyecto.");
  assert.equal(directives[1].rule, "Regla global.");
  assert.ok(!directives.some((item) => item.rule === "Regla vieja."));
});

test("respects the injected character budget", () => {
  const { dir, env } = tempProject();
  remember(dir, "Regla uno bastante larga para consumir presupuesto.", {
    scope: "project",
    topic: "behavior/one",
  }, env);
  remember(dir, "Regla dos bastante larga para consumir presupuesto.", {
    scope: "project",
    topic: "behavior/two",
  }, env);

  const directives = activeDirectives(dir, { env, maxChars: 40 });
  assert.equal(directives.length, 1);
});
