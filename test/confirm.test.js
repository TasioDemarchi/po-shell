import test from "node:test";
import assert from "node:assert/strict";
import {
  CONFIRM_ALLOW,
  CONFIRM_DENY,
  destructiveTitle,
  guardLabel,
  planApprovalTitle,
  previewCommand,
  confirmDestructive,
} from "../src/confirm.js";

const verdict = { key: "rmRecursive", targets: ["build/"] };

test("allows only an explicit allow answer", async () => {
  const ctx = { hasUI: true, ui: { select: async () => CONFIRM_ALLOW } };
  assert.equal(await confirmDestructive(ctx, verdict, { command: "rm -rf build/" }), true);

  const denied = { hasUI: true, ui: { select: async () => CONFIRM_DENY } };
  assert.equal(await confirmDestructive(denied, verdict, { command: "rm -rf build/" }), false);
});

test("fails closed without a usable UI", async () => {
  assert.equal(await confirmDestructive({ hasUI: false, ui: { select: async () => CONFIRM_ALLOW } }, verdict, {}), false);
  assert.equal(await confirmDestructive({ hasUI: true }, verdict, {}), false);
  assert.equal(await confirmDestructive({ hasUI: true, ui: { select: async () => "otra cosa" } }, verdict, {}), false);
  assert.equal(await confirmDestructive({ hasUI: true, ui: { select: async () => { throw new Error("cancelled"); } } }, verdict, {}), false);
  assert.equal(await confirmDestructive(undefined, verdict, {}), false);
});

test("the destructive dialogue has a title in words, never the raw guard key", () => {
  const title = destructiveTitle(verdict, { command: "rm -rf   build/" });
  assert.match(title, /^Allow destructive command · recursive delete · build\//);
  assert.match(title, /rm -rf build\//);
  assert.ok(!title.includes("rmRecursive"));

  assert.match(destructiveTitle({ key: "gitResetHard" }, { command: "reset" }), /hard reset \(discards changes\)/);
  assert.match(destructiveTitle({ key: "destructiveSql" }, { command: 'sqlite3 x "DROP TABLE y"' }), /SQL that deletes data/);
  assert.match(destructiveTitle({ key: "unknownKey" }, { command: "x" }), /destructive command/);
  assert.equal(guardLabel("findDelete"), "bulk delete with find");
});

test("the plan dialogue shows a title and one short line, not the plan", () => {
  const task = {
    title: "Delegación real",
    plan: "1. U1 roles\n2. U2 superficies\n3. U3 perfil\n",
    planSummary: "5 unidades: roles, superficies, cap, perfil y docs.",
  };
  const title = planApprovalTitle(task);
  assert.match(title, /^Approve plan · Delegación real\n5 unidades/);
  assert.ok(!title.includes("U2 superficies"));

  const noSummary = planApprovalTitle({ title: "Sin resumen", plan: "1. Primer paso concreto\n2. Otro" });
  assert.match(noSummary, /^Approve plan · Sin resumen\nPrimer paso concreto$/);

  assert.equal(planApprovalTitle({ title: "Vacía" }), "Approve plan · Vacía");
  assert.equal(planApprovalTitle(undefined), "Approve plan · task");
});

test("previews are single-line and bounded", () => {
  assert.equal(previewCommand({ command: "  echo   hola  " }), "echo hola");
  assert.equal(previewCommand({ command: "x".repeat(400) }).length, 241);
  assert.equal(previewCommand({}), "");
});
