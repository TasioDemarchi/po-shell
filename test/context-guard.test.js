import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_CONTEXT_GUARD,
  contextDirective,
  contextPressure,
  formatPressure,
  guardLevel,
  promptTokens,
} from "../src/context-guard.js";
import {
  checkPolicy,
  createTask,
  effectiveDelegation,
  loadConfig,
  readContextPressure,
  renderContext,
  renderStatus,
  saveConfig,
  saveContextPressure,
  updateTask,
} from "../src/kernel.js";
import { projectStateDir } from "../src/project.js";

process.env.PO_SHELL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "po-shell-context-home-"));

function tempProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "po-shell-context-"));
}

test("prompt size is input plus cached reads and writes", () => {
  assert.equal(promptTokens({ input: 100, cacheRead: 900, cacheWrite: 10 }), 1010);
  assert.equal(promptTokens({ input: 100, cached: 900 }), 1000);
  assert.equal(promptTokens(undefined), 0);
});

test("a ratio needs a denominator", () => {
  assert.equal(contextPressure({ tokens: 100, window: 0 }), null);
  assert.equal(contextPressure({ tokens: 0, window: 1_000_000 }), null);
  assert.deepEqual(contextPressure({ tokens: 150_000, window: 1_000_000 }), {
    tokens: 150_000,
    window: 1_000_000,
    ratio: 0.15,
  });
});

test("levels are relative to the window and configurable", () => {
  assert.equal(guardLevel(0.01), "ok");
  assert.equal(guardLevel(0.15), "warn");
  assert.equal(guardLevel(0.3), "delegate");
  assert.equal(guardLevel(0.96), "delegate");
  assert.equal(guardLevel(0.2, { warnAt: 0.5, delegateAt: 0.9 }), "ok");
  assert.equal(guardLevel(NaN), "ok");
  assert.equal(DEFAULT_CONTEXT_GUARD.enforce, false);
});

test("the state line and the directive are readable", () => {
  const pressure = contextPressure({ tokens: 56_840, window: 1_048_576 });
  assert.equal(formatPressure(pressure), "5.4% (56.8k/1.0M)");
  assert.equal(formatPressure(null), null);
  assert.match(contextDirective("warn"), /delegá el trabajo mecánico/);
  assert.match(contextDirective("delegate"), /umbral de delegación/);
  assert.equal(contextDirective("ok"), null);
});

test("pressure is recorded, and only a rise in level is an event", () => {
  const dir = tempProject();
  createTask(dir, { title: "medición", risk: "low" });

  const low = saveContextPressure(dir, { tokens: 10_000, window: 1_000_000 });
  assert.equal(low.level, "ok");
  assert.deepEqual(readContextPressure(dir), low);

  const warn = saveContextPressure(dir, { tokens: 200_000, window: 1_000_000 });
  assert.equal(warn.level, "warn");
  saveContextPressure(dir, { tokens: 210_000, window: 1_000_000 });
  const events = fs
    .readFileSync(path.join(projectStateDir(dir), "events.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .filter((event) => event.type.startsWith("context."));
  assert.deepEqual(events.map((event) => event.type), ["context.warn"]);

  const delegate = saveContextPressure(dir, { tokens: 400_000, window: 1_000_000 });
  assert.equal(delegate.level, "delegate");
  assert.match(renderContext(dir), /context: 40\.0% \(400\.0k\/1\.0M\)/);
  assert.match(renderContext(dir), /context_rule: el contexto pasó el umbral/);
});

test("enforce raises the profile to delegate-writes; without it nothing changes", () => {
  const dir = tempProject();
  const task = createTask(dir, { title: "presión", risk: "low" });
  saveContextPressure(dir, { tokens: 400_000, window: 1_000_000 });
  assert.equal(effectiveDelegation(dir), "inline", "sin enforce no cambia nada");
  assert.equal(checkPolicy(dir, "write", { path: "src/app.js", content: "x" }).block, false);

  saveConfig(dir, { contextGuard: { warnAt: 0.15, delegateAt: 0.3, enforce: true } });
  assert.equal(effectiveDelegation(dir), "delegate-writes");
  const blocked = checkPolicy(dir, "write", { path: "src/app.js", content: "x" });
  assert.equal(blocked.block, true);
  assert.match(blocked.reason, /contexto al 40\.0% de la ventana/);
  assert.equal(checkPolicy(dir, "write", { path: "docs/features/x.md", content: "# x" }).block, false);

  updateTask(dir, task.id, { delegation: "delegate-writes" });
  assert.equal(effectiveDelegation(dir), "delegate-writes");
  assert.match(renderStatus(dir), /Delegación: delegate-writes · Contexto: 40\.0%/);
});

test("below the threshold enforce does not block", () => {
  const dir = tempProject();
  createTask(dir, { title: "holgado", risk: "low" });
  saveConfig(dir, { contextGuard: { warnAt: 0.15, delegateAt: 0.3, enforce: true } });
  saveContextPressure(dir, { tokens: 20_000, window: 1_000_000 });
  assert.equal(effectiveDelegation(dir), "inline");
  assert.equal(checkPolicy(dir, "write", { path: "src/app.js", content: "x" }).block, false);
  assert.match(renderContext(dir), /context: 2\.0%/);
});
