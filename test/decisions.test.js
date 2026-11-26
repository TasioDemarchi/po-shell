import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  FOLLOW_UP,
  appendDecision,
  askOptions,
  isFollowUp,
  decisionsSection,
  nextDecisionId,
  orphanDecisions,
  parseDecisions,
} from "../src/decisions.js";
import { activeTask, addDecision, createTask, getTask, init, renderContext, searchMemory, updateTask } from "../src/kernel.js";
import { indexProject } from "../src/indexer.js";

const DOC = [
  "# Feature: ejemplo",
  "",
  "## Design",
  "",
  "algo",
  "",
  "## Decisions",
  "",
  "- D1 — sin inbox",
  "- D2 — sin contador",
  "",
  "## Units",
  "",
  "- [ ] U6 — documentos (D1)",
  "",
].join("\n");

test("parseDecisions reads the section and nothing else", () => {
  assert.deepEqual(parseDecisions(DOC), [
    { id: "D1", text: "sin inbox" },
    { id: "D2", text: "sin contador" },
  ]);
  assert.equal(decisionsSection("# x\n"), "");
  assert.deepEqual(parseDecisions(""), []);
});

test("nextDecisionId continues the sequence, not the line count", () => {
  assert.equal(nextDecisionId(DOC), "D3");
  assert.equal(nextDecisionId(""), "D1");
  assert.equal(nextDecisionId("## Decisions\n\n- D9 — x\n"), "D10");
});

test("appendDecision writes inside the section, never after the next heading", () => {
  const next = appendDecision(DOC, { id: "D3", line: "capturar en el turno" });
  const unitsAt = next.indexOf("## Units");
  assert.ok(next.indexOf("- D3 — capturar en el turno") < unitsAt, "the decision stays above Units");
  assert.deepEqual(parseDecisions(next).map((item) => item.id), ["D1", "D2", "D3"]);
});

test("appendDecision creates the section when the doc has none", () => {
  const next = appendDecision("# Solo\n", { id: "D1", line: "primera" });
  assert.ok(next.includes("## Decisions\n\n- D1 — primera\n"));
  assert.ok(next.startsWith("# Solo"));
});

test("orphanDecisions flags a decision no unit implements", () => {
  assert.deepEqual(orphanDecisions(DOC), ["D2"]);
  assert.deepEqual(orphanDecisions(appendDecision(DOC, { id: "D3", line: "x" })), ["D2", "D3"]);
  assert.deepEqual(orphanDecisions(""), []);
});

test("addDecision writes the line in the doc and the record in the task", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "po-shell-decisions-"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "po-shell-decisions-repo-"));
  const env = { ...process.env, PO_SHELL_HOME: home };
  init(dir, env);
  fs.mkdirSync(path.join(dir, "docs/features"), { recursive: true });
  fs.writeFileSync(path.join(dir, "docs/features/x.md"), DOC.replace("- [ ] U6 — documentos (D1)", "- [ ] U6 — documentos (D1, D3)"));

  const task = createTask(dir, { title: "Con decisiones", risk: "low" }, env);
  // `feature_doc` as a task field arrives with U6; the pointer is what counts here.
  updateTask(dir, task.id, { featureDoc: "docs/features/x.md" }, env);
  assert.equal(activeTask(dir, env).id, task.id);

  const first = addDecision(dir, { text: "sin inbox: el trabajo de depurar no se paga" }, env);
  assert.equal(first.id, "D3");
  assert.equal(first.total, 1);
  assert.deepEqual(first.orphans, ["D2"], "D3 is referenced by a unit; D2 was never implemented");

  const second = addDecision(dir, { text: "sin contador de pendientes" }, env);
  assert.equal(second.id, "D4");
  assert.deepEqual(second.orphans, ["D2", "D4"], "nobody implements them yet");

  const stored = getTask(dir, task.id, env).decisions;
  assert.deepEqual(stored.map((item) => item.id), ["D3", "D4"]);
  assert.match(renderContext(dir, env), /rule: knowledge is saved in the turn you learn it/);
});

test("addDecision without text, task or feature doc", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "po-shell-decisions2-"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "po-shell-decisions2-repo-"));
  const env = { ...process.env, PO_SHELL_HOME: home };
  init(dir, env);
  assert.throws(() => addDecision(dir, { text: "algo decidido" }, env), /needs a task/);

  const task = createTask(dir, { title: "Sin doc", risk: "low" }, env);
  assert.throws(() => addDecision(dir, { text: "corto" }, env), /at least 8 characters/);

  const saved = addDecision(dir, { text: "una decision sin documento" }, env);
  assert.equal(saved.id, "D1");
  assert.equal(saved.doc, "", "no feature doc: the record lives in the task JSON");
  assert.equal(getTask(dir, task.id, env).decisions.length, 1);
});

test("a decision is one line in the state block, whatever the count", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "po-shell-decisions3-"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "po-shell-decisions3-repo-"));
  const env = { ...process.env, PO_SHELL_HOME: home };
  init(dir, env);
  const task = createTask(dir, { title: "Varias decisiones", risk: "low" }, env);

  const before = renderContext(dir, env);
  const rule = before.split("\n").filter((line) => line.startsWith("rule:"));
  assert.equal(rule.length, 2, "the block carries both rules");

  for (let index = 0; index < 5; index += 1) {
    addDecision(dir, { text: `decision numero ${index} del proyecto` }, env);
  }
  const after = renderContext(dir, env);
  assert.deepEqual(
    after.split("\n").filter((line) => line.startsWith("rule:")),
    rule,
    "the block does not grow with the decisions",
  );
  assert.equal(getTask(dir, task.id, env).decisions.length, 5);
});

test("the ask always offers a way to keep talking", () => {
  assert.deepEqual(askOptions(["Aceptar", "Rechazar"]), ["Aceptar", "Rechazar", FOLLOW_UP]);
  assert.deepEqual(askOptions(["Sí", "seguir analizando"]), ["Sí", "seguir analizando"], "no duplicate");
  assert.deepEqual(askOptions(["Sí", "Seguir pensando"]), ["Sí", "Seguir pensando"]);
  assert.deepEqual(askOptions([]), [FOLLOW_UP]);
  assert.equal(isFollowUp("keep analyzing"), true);
  assert.equal(isFollowUp("seguir analizando"), true);
  assert.equal(isFollowUp("Acepto"), false);
  assert.equal(isFollowUp(undefined), false);
});

test("a decision the agent took under a delegated plan says so", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "po-shell-decisions4-"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "po-shell-decisions4-repo-"));
  const env = { ...process.env, PO_SHELL_HOME: home };
  init(dir, env);
  const task = createTask(dir, { title: "Con agente", risk: "low" }, env);

  const human = addDecision(dir, { text: "el humano eligio esto" }, env);
  const agent = addDecision(dir, { text: "el agente decidio aquello", by: "agent" }, env);
  assert.equal(human.by, "human");
  assert.equal(agent.by, "agent");

  const stored = getTask(dir, task.id, env).decisions;
  assert.equal(stored[0].text, "el humano eligio esto");
  assert.equal(stored[1].text, "(agente) el agente decidio aquello", "the line says who decided");
  assert.equal(stored[1].by, "agent");
});

test("a durable decision writes both artifacts, in one call", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "po-shell-durable-"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "po-shell-durable-repo-"));
  const env = { ...process.env, PO_SHELL_HOME: home };
  init(dir, env);
  fs.mkdirSync(path.join(dir, "docs/features"), { recursive: true });
  fs.writeFileSync(path.join(dir, "docs/features/x.md"), DOC.replace("- [ ] U6 — documentos (D1)", "- [ ] U6 — documentos (D1, D3, D4)"));
  const task = createTask(dir, { title: "Con durables", risk: "low" }, env);
  updateTask(dir, task.id, { featureDoc: "docs/features/x.md" }, env);

  const slice = addDecision(dir, { text: "una decision de esta rebanada" }, env);
  assert.equal(slice.durable, false);
  assert.equal(slice.memory, null, "a slice decision does not touch memory");

  const durable = addDecision(dir, { text: "el protocolo es el AGENTS.md global", durable: true }, env);
  assert.equal(durable.durable, true);
  assert.ok(durable.memory, "the memory was written");

  indexProject(dir, { env });
  const hits = searchMemory(dir, "AGENTS global", 5, env);
  const found = JSON.stringify(hits);
  assert.match(found, /AGENTS\.md global|decision-d4/);
  assert.equal(getTask(dir, task.id, env).decisions.length, 2);
});

test("the state block states memory before decisions, in two constant lines", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "po-shell-rules-"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "po-shell-rules-repo-"));
  const env = { ...process.env, PO_SHELL_HOME: home };
  init(dir, env);
  createTask(dir, { title: "Reglas", risk: "low" }, env);

  const rules = renderContext(dir, env).split("\n").filter((line) => line.startsWith("rule:"));
  assert.equal(rules.length, 2);
  assert.match(rules[0], /po_shell_memory/, "memory first");
  assert.match(rules[1], /action=decision/, "and durable: true adds the memory");
});
