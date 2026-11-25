import assert from "node:assert/strict";
import test from "node:test";
import {
  editStats,
  formatCall,
  formatDuration,
  formatResult,
  lineCount,
  oneLine,
  resultText,
  shortPath,
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
  assert.equal(task.text, "task · new · Un título largo");

  const delegate = formatCall("po_shell_delegate", { role: "worker", task: "Implementar U1" }, { cwd });
  assert.equal(delegate.text, "delegate · worker");
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
