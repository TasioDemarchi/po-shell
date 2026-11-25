import assert from "node:assert/strict";
import test from "node:test";
import {
  FOOTER_GAP,
  TOOL_STYLE,
  contextLabel,
  creditLabel,
  dirtyCount,
  editStats,
  footerLine,
  formatCall,
  formatDuration,
  formatResult,
  gitLabel,
  homePath,
  lineCount,
  modelLabel,
  oneLine,
  panelRowChildren,
  panelRowEvidence,
  panelRowTask,
  panelRows,
  resultText,
  shortModel,
  shortPath,
  shouldShowPanel,
  taskLabel,
  textWidth,
  toolStyle,
} from "../src/minimal-ui.js";

const cwd = "/home/dev/project";

function result(text) {
  return { content: [{ type: "text", text }], details: undefined };
}

test("oneLine collapses whitespace and cuts with an ellipsis", () => {
  assert.equal(oneLine("  npm   test  "), "npm test");
  assert.equal(oneLine("a\nb\tc"), "a b c");
  assert.equal(oneLine("x".repeat(80), 10), "xxxxxxxxx…");
  assert.equal(oneLine("", 10), "");
  assert.equal(oneLine(null, 10), "");
});

test("shortPath is repo-relative inside cwd and home-relative outside", () => {
  assert.equal(shortPath("/home/dev/project/src/a.js", cwd), "src/a.js");
  assert.equal(shortPath("src/a.js", cwd), "src/a.js");
  assert.equal(shortPath("/elsewhere/b.js", cwd), "/elsewhere/b.js");
  const previous = process.env.HOME;
  process.env.HOME = "/home/dev";
  try {
    assert.equal(shortPath("/home/dev/other/c.js", cwd), "~/other/c.js");
  } finally {
    if (previous === undefined) delete process.env.HOME;
    else process.env.HOME = previous;
  }
});

test("formatDuration switches unit by magnitude", () => {
  assert.equal(formatDuration(90), "90ms");
  assert.equal(formatDuration(6500), "6.5s");
  assert.equal(formatDuration(125_000), "2m05s");
  assert.equal(formatDuration(undefined), "");
});

test("editStats counts lines of every edit and ignores empty sides", () => {
  assert.deepEqual(editStats([{ oldText: "a\nb", newText: "a\nb\nc" }]), { added: 3, removed: 2 });
  assert.deepEqual(editStats([{ oldText: "", newText: "nuevo" }]), { added: 1, removed: 0 });
  assert.deepEqual(editStats(undefined), { added: 0, removed: 0 });
  assert.equal(lineCount(""), 0);
  assert.equal(lineCount("a\nb"), 2);
});

test("resultText joins text parts and ignores the rest", () => {
  assert.equal(resultText(result("hola")), "hola");
  assert.equal(resultText({ content: [{ type: "image", data: "x" }] }), "");
  assert.equal(resultText(undefined), "");
});

test("toolStyle falls back to a neutral bullet", () => {
  assert.equal(toolStyle("bash").icon, "🐚");
  assert.equal(toolStyle("nope").icon, "•");
  assert.equal(toolStyle("nope").label, "");
});

test("every known tool carries an English label", () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(TOOL_STYLE).map(([name, style]) => [name, style.label])),
    {
      bash: "shell",
      edit: "edit",
      write: "write",
      read: "read",
      grep: "search",
      find: "search",
      ls: "list",
      po_shell_status: "status",
      po_shell_task: "task",
      po_shell_memory: "memory",
      po_shell_check: "check",
      po_shell_review: "review",
      po_shell_ask: "ask",
      po_shell_delegate: "delegate",
      context_search: "search",
      context_get: "get",
    },
  );
});

test("every icon is one emoji cell wide, never a narrow dingbat", () => {
  // A one-cell icon next to a two-cell one breaks the gutter after the icon.
  const defaultEmoji = new Set([0x2705, 0x2753]);
  for (const [name, style] of Object.entries(TOOL_STYLE)) {
    const chars = [...style.icon];
    const [first] = chars;
    const wide = chars.length === 1 && first.codePointAt(0) >= 0x1f300;
    const forced = chars.length === 2 && chars[1] === "\uFE0F";
    const emojiByDefault = chars.length === 1 && defaultEmoji.has(first.codePointAt(0));
    assert.ok(wide || forced || emojiByDefault, `${name} icon ${JSON.stringify(style.icon)} is narrower than the rest`);
  }
});

test("formatCall carries the label and drops it from the text", () => {
  const bash = formatCall("bash", { command: "npm test" }, { cwd });
  assert.equal(bash.label, "shell");
  assert.equal(bash.text, "npm test");

  assert.equal(formatCall("edit", { path: "src/a.js", edits: [] }, { cwd }).label, "edit");
  assert.equal(formatCall("write", { path: "a.md", content: "" }, { cwd }).label, "write");
  assert.equal(formatCall("read", { path: "a.md" }, { cwd }).label, "read");
  assert.equal(formatCall("grep", { pattern: "x" }, { cwd }).label, "search");
  assert.equal(formatCall("find", { pattern: "x" }, { cwd }).label, "search");
  assert.equal(formatCall("ls", { path: "." }, { cwd }).label, "list");

  const wordless = formatCall("po_shell_check", {}, { cwd });
  assert.equal(wordless.label, "check");
  assert.equal(wordless.text, "");
  assert.equal(formatCall("po_shell_status", {}, { cwd }).text, "");

  const task = formatCall("po_shell_task", { action: "new", title: "Un título largo" }, { cwd });
  assert.equal(task.label, "task");
  assert.equal(task.text, "new · Un título largo");

  const delegate = formatCall("po_shell_delegate", { role: "worker", task: "Implementar U1" }, { cwd });
  assert.equal(delegate.text, "worker");
  assert.equal(delegate.meta, "Implementar U1");
});

test("label plus subject fits in 80 columns", () => {
  const call = formatCall("bash", { command: `echo ${"x".repeat(200)}` }, { cwd });
  assert.ok(`${call.label} · ${call.text}`.length <= 80);
  const edit = formatCall("edit", { path: "src/a.js", edits: [{ oldText: "a", newText: "b" }] }, { cwd });
  assert.ok(`${edit.label} · ${edit.text}  ${edit.meta}`.length <= 80);
});

test("formatCall renders one line per tool", () => {
  const bash = formatCall("bash", { command: "npm test -- --watch" }, { cwd });
  assert.equal(bash.text, "npm test -- --watch");
  assert.equal(bash.tone, "accent");

  const edit = formatCall("edit", { path: "/home/dev/project/src/a.js", edits: [{ oldText: "a", newText: "a\nb" }] }, { cwd });
  assert.equal(edit.text, "src/a.js");
  assert.equal(edit.meta, "+2 −1");

  const write = formatCall("write", { path: "docs/x.md", content: "a\nb\nc" }, { cwd });
  assert.equal(write.text, "docs/x.md");
  assert.equal(write.meta, "3 L");

  const read = formatCall("read", { path: "src/a.js", offset: 10, limit: 5 }, { cwd });
  assert.equal(read.text, "src/a.js:11-15");

  const task = formatCall("po_shell_task", { action: "new", title: "Un título largo" }, { cwd });
  assert.equal(task.text, "new · Un título largo");

  const delegate = formatCall("po_shell_delegate", { role: "worker", task: "Implementar U1" }, { cwd });
  assert.equal(delegate.text, "worker");
  assert.equal(delegate.meta, "Implementar U1");
});

test("formatCall truncates a very long command", () => {
  const call = formatCall("bash", { command: `echo ${"x".repeat(200)}` }, { cwd });
  assert.ok(call.text.length <= 72);
  assert.ok(call.text.endsWith("…"));
});

test("formatResult keeps successes quiet and shows failures", () => {
  assert.deepEqual(formatResult("bash", {}, result("all good\nmany lines"), { durationMs: 6500 }), [
    { tone: "success", text: "✓ 6.5s" },
  ]);
  assert.deepEqual(formatResult("edit", {}, result("ok"), {}), []);

  const failed = formatResult("bash", {}, result("boom\nline 2\nline 3\nline 4"), { isError: true });
  assert.equal(failed.length, 3);
  assert.equal(failed[0].tone, "error");
  assert.equal(failed[0].text, "✗ boom");
  assert.equal(failed[1].text, "  line 2");
});

test("formatResult counts hits for search tools and summarizes po-shell tools", () => {
  assert.deepEqual(formatResult("grep", {}, result("a:1\nb:2"), {}), [{ tone: "muted", text: "2 results" }]);
  assert.deepEqual(formatResult("grep", {}, result("a:1"), {}), [{ tone: "muted", text: "1 result" }]);

  const task = formatResult("po_shell_task", {}, result("Tarea creada.\ndetalle\nmás"), {});
  assert.deepEqual(task, [{ tone: "muted", text: "Tarea creada. +2" }]);

  const ask = formatResult("po_shell_ask", {}, result("Aprobar"), {});
  assert.deepEqual(ask, [{ tone: "muted", text: "Aprobar" }]);
});

test("formatResult while streaming shows the last line", () => {
  const partial = formatResult("bash", {}, result("line 1\nline 2\n"), { isPartial: true });
  assert.deepEqual(partial, [{ tone: "dim", text: "line 2" }]);
  assert.deepEqual(formatResult("bash", {}, result(""), { isPartial: true }), [{ tone: "dim", text: "⋯" }]);
});

test("dirtyCount and gitLabel say how dirty the worktree is", () => {
  assert.equal(dirtyCount(""), 0);
  assert.equal(dirtyCount(" M a.js\n?? b.js\n"), 2);
  assert.equal(dirtyCount(" \n\n"), 0);
  assert.equal(gitLabel("main", 0), "main");
  assert.equal(gitLabel("main", 3), "main ±3");
  assert.equal(gitLabel("", 3), "");
  assert.equal(gitLabel("main", "x"), "main");
});

test("homePath keeps the path short and the last segment shorter", () => {
  assert.equal(homePath("/home/dev/po-shell", "/home/dev"), "~/po-shell");
  assert.equal(homePath("/home/dev/po-shell", "/home/tachii"), "/home/dev/po-shell");
  assert.equal(homePath("/home/dev", "/home/dev"), "~");
  assert.equal(homePath("/srv/app", "/home/dev"), "/srv/app");
  assert.equal(homePath("/srv/app", ""), "/srv/app");
});

test("creditLabel rounds by size and marks unknown rates", () => {
  assert.equal(creditLabel(0), "0cr");
  assert.equal(creditLabel(0.3141), "0.31cr");
  assert.equal(creditLabel(18.62), "18.6cr");
  assert.equal(creditLabel(2.5), "2.50cr");
  assert.equal(creditLabel(18.62, { known: false }), "~18.6cr");
  assert.equal(creditLabel(undefined), "0cr");
});

test("contextLabel says ctx ? when Pi has no estimate", () => {
  assert.equal(contextLabel(12.4), "ctx 12%");
  assert.equal(contextLabel(0), "ctx 0%");
  assert.equal(contextLabel(null), "ctx ?");
  assert.equal(contextLabel(undefined), "ctx ?");
});

test("modelLabel keeps the model and the thinking level", () => {
  assert.equal(modelLabel("deepseek-v4-flash", "low"), "deepseek-v4-flash · low");
  assert.equal(modelLabel("deepseek-v4-flash", undefined), "deepseek-v4-flash");
  assert.equal(modelLabel("", "low"), "low");
  assert.equal(shortModel("deepseek-v4-flash"), "flash");
  assert.equal(shortModel("glm5.3"), "glm5.3");
  assert.equal(shortModel(""), "");
});

test("taskLabel shows the phase, not the whole task", () => {
  assert.equal(taskLabel({ phase: "ready", title: "algo" }), "📋 ready");
  assert.equal(taskLabel(null), "");
  assert.equal(taskLabel({}), "");
});

function footerBlocks() {
  return {
    left: [
      { text: "~/dev/po-shell", compact: "po-shell" },
      { text: "main ±3", compact: "main" },
      { text: "📋 ready" },
    ],
    right: [
      { text: "18.6cr", keep: true },
      { text: "ctx 12%", keep: true },
      { text: "deepseek-v4-flash · low", compact: "flash" },
    ],
  };
}

const WIDE = "~/dev/po-shell · main ±3 · 📋 ready";
const MODEL = "18.6cr · ctx 12% · deepseek-v4-flash · low";
const COMPACT = "18.6cr · ctx 12% · flash";
const COMPACT_LEFT = "po-shell · main · 📋 ready";

function spaced(width, left, right) {
  return `${left}${" ".repeat(Math.max(FOOTER_GAP, width - textWidth(left) - textWidth(right)))}${right}`;
}

test("textWidth counts columns, not code points", () => {
  assert.equal(textWidth("main"), 4);
  assert.equal(textWidth("📋 ready"), 8);
  assert.equal(textWidth("✏️"), 2);
  assert.equal(textWidth(""), 0);
});

test("footerLine puts the project left and the model right", () => {
  const line = footerLine(footerBlocks(), { width: 120 });
  assert.equal(line, spaced(120, WIDE, MODEL));
  assert.equal(textWidth(line), 120);
  assert.ok(line.startsWith(WIDE));
  assert.ok(line.endsWith(MODEL));

  const wide = footerLine(footerBlocks(), { width: 200 });
  assert.equal(textWidth(wide), 200);
  assert.ok(wide.endsWith(MODEL));
});

test("footerLine without a width or without blocks stays plain", () => {
  assert.equal(footerLine(footerBlocks()), `${WIDE}${" ".repeat(FOOTER_GAP)}${MODEL}`);
  assert.equal(footerLine({}, { width: 80 }), "");
  assert.equal(footerLine({ left: [{ text: "" }] }, { width: 80 }), "");
});

test("footerLine compacts both blocks before dropping anything", () => {
  const line = footerLine(footerBlocks(), { width: 64 });
  assert.equal(line, spaced(64, COMPACT_LEFT, COMPACT));
  assert.equal(textWidth(line), 64);
});

test("footerLine drops the project before the model and never the credits", () => {
  const narrow = footerLine(footerBlocks(), { width: 40 });
  assert.equal(narrow, spaced(40, "📋 ready", COMPACT));
  assert.ok(!narrow.includes("main"));

  const tiny = footerLine(footerBlocks(), { width: 28 });
  assert.equal(tiny, `${" ".repeat(28 - textWidth(COMPACT))}${COMPACT}`);
  assert.equal(textWidth(tiny), 28);
  assert.ok(tiny.startsWith(" "));

  const exact = footerLine(footerBlocks(), { width: textWidth(COMPACT) });
  assert.equal(exact, COMPACT);
});

test("footerLine cuts the model block, not the padding, when nothing fits", () => {
  const cut = footerLine(footerBlocks(), { width: 12 });
  assert.ok(textWidth(cut) <= 12);
  assert.ok(cut.startsWith("18.6"));
  assert.ok(cut.endsWith("…"));
});

test("panelRowTask shows the whole task, not just its id", () => {
  const row = panelRowTask({
    id: "guard-de-contexto-mwvfpt33",
    phase: "ready",
    risk: "medium",
    next: "review the frozen diff",
    evidence: [{ kind: "checks" }, { kind: "review" }],
  });
  assert.equal(
    row,
    "📋 guard-de-contexto-mwvfpt33 · ready · med · evidence 2 · next: review the frozen diff",
  );
  assert.equal(panelRowTask({ id: "x", phase: "planned" }), "📋 x · planned · evidence 0");
  assert.equal(panelRowTask(null), "");
  assert.equal(panelRowTask({}), "");
});

test("panelRowChildren lists live children with elapsed and credits", () => {
  const row = panelRowChildren([
    { role: "worker", elapsedMs: 41_000, credits: 0.314 },
    { role: "explorer", elapsedMs: 12_000 },
  ]);
  assert.equal(row, "🤖 worker 41.0s · 0.31cr     🤖 explorer 12.0s · ·");
  assert.equal(panelRowChildren([]), "");
  assert.equal(panelRowChildren([{ elapsedMs: 1 }]), "");
});

test("panelRowEvidence says pass or fail, review and dirty files", () => {
  assert.equal(
    panelRowEvidence({ checks: { total: 185, failed: 0 }, review: { id: "mwvis2b5" }, dirty: 8 }),
    "✓ 185/185 · review mwvis2b5 · 8 files uncommitted",
  );
  assert.equal(panelRowEvidence({ checks: { total: 3, failed: 1 } }), "✗ 2/3");
  assert.equal(panelRowEvidence({ dirty: 1 }), "1 file uncommitted");
  assert.equal(panelRowEvidence({}), "");
});

test("panelRows hides a row that does not fit instead of cutting it", () => {
  const state = {
    task: { id: "guard-de-contexto-mwvfpt33", phase: "ready", risk: "medium", evidence: [] },
    children: [{ role: "worker", elapsedMs: 41_000, credits: 0.31 }],
    checks: { total: 185, failed: 0 },
    dirty: 3,
  };
  assert.equal(panelRows(state, { width: 120 }).length, 3);

  const narrow = panelRows(state, { width: 40 });
  assert.deepEqual(narrow, ["🤖 worker 41.0s · 0.31cr", "✓ 185/185 · 3 files uncommitted"]);
  assert.equal(panelRows(state, { maxRows: 2 }).length, 2);
  assert.deepEqual(panelRows({}, { width: 80 }), []);
});

test("shouldShowPanel stays quiet in auto until something is wrong", () => {
  assert.equal(shouldShowPanel({ mode: "auto" }), false);
  assert.equal(shouldShowPanel({ mode: "auto", dirty: 0, contextLevel: "ok" }), false);
  assert.equal(shouldShowPanel({ mode: "off", children: [{ role: "worker" }] }), false);
  assert.equal(shouldShowPanel({ mode: "on" }), true);

  const triggers = [
    { children: [{ role: "worker" }] },
    { lastCheckFailed: true },
    { pendingHighPlan: true },
    { contextLevel: "warn" },
    { contextLevel: "delegate" },
    { dirty: 2 },
  ];
  for (const trigger of triggers) {
    assert.equal(shouldShowPanel({ mode: "auto", ...trigger }), true, JSON.stringify(trigger));
  }
});
