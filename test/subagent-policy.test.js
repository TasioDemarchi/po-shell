import test from "node:test";
import assert from "node:assert/strict";
import { subagentToolBlock } from "../src/subagent-policy.js";

test("blocks po-shell orchestrator tools", () => {
  assert.ok(subagentToolBlock("po_shell_memory", {}));
  assert.ok(subagentToolBlock("po_shell_task", {}));
  assert.equal(subagentToolBlock("read", { path: "README.md" }), null);
});

test("blocks Markdown and po-shell state writes", () => {
  assert.ok(subagentToolBlock("write", { path: "README.md" }));
  assert.ok(subagentToolBlock("edit", { path: "docs/design.MD" }));
  assert.ok(subagentToolBlock("write", { path: ".po-shell/tasks/x.json" }));
  assert.equal(subagentToolBlock("write", { path: "src/app.js" }), null);
});

test("blocks shell writes to Markdown and po-shell state", () => {
  assert.ok(subagentToolBlock("bash", { command: "echo hola >> README.md" }));
  assert.ok(subagentToolBlock("bash", { command: "sed -i 's/a/b/' docs/design.md" }));
  assert.ok(subagentToolBlock("bash", { command: "echo x > .po-shell/events.jsonl" }));
  assert.equal(subagentToolBlock("bash", { command: "grep hola README.md" }), null);
});

test("blocks destructive shell commands in children, confirmed or not", () => {
  assert.match(subagentToolBlock("bash", { command: "rm -rf /" }), /destructivos/);
  assert.match(subagentToolBlock("bash", { command: "rm -rf build/" }), /destructivos/);
  assert.match(subagentToolBlock("bash", { command: 'sh -c "git reset --hard"' }), /destructivos/);
  assert.equal(subagentToolBlock("bash", { command: "rm build/tmp.txt" }), null);
  assert.equal(subagentToolBlock("bash", { command: "git status" }), null);
});

test("a writer is confined to its declared surfaces", () => {
  const cwd = "/repo";
  const surfaces = ["src/", "test/helpers.js", "docs/*.md"];
  assert.equal(subagentToolBlock("write", { path: "src/app.js" }, cwd, { surfaces }), null);
  assert.equal(subagentToolBlock("write", { path: "src/deep/nested.js" }, cwd, { surfaces }), null);
  assert.equal(subagentToolBlock("edit", { path: "/repo/test/helpers.js" }, cwd, { surfaces }), null);
  assert.match(subagentToolBlock("write", { path: "lib/other.js" }, cwd, { surfaces }), /fuera/);
  assert.match(subagentToolBlock("write", { path: "/repo/package.json" }, cwd, { surfaces }), /fuera/);
  assert.match(subagentToolBlock("edit", { path: "../outside.txt" }, cwd, { surfaces }), /fuera|superficies/);
});

test("shell writes outside the surfaces are refused too", () => {
  const cwd = "/repo";
  const surfaces = ["src/"];
  assert.equal(subagentToolBlock("bash", { command: "npm test" }, cwd, { surfaces }), null);
  assert.equal(subagentToolBlock("bash", { command: "echo x > src/a.js" }, cwd, { surfaces }), null);
  assert.match(subagentToolBlock("bash", { command: "echo x >> lib/b.js" }, cwd, { surfaces }), /fuera/);
  assert.match(subagentToolBlock("bash", { command: "sed -i 's/a/b/' tools/c.sh" }, cwd, { surfaces }), /fuera/);
});

test("without surfaces nothing new is blocked", () => {
  assert.equal(subagentToolBlock("write", { path: "src/app.js" }, "/repo", {}), null);
  assert.equal(subagentToolBlock("bash", { command: "echo x > anywhere.txt" }, "/repo"), null);
});

/* --------------------------- role matrix --------------------------- */

const repoCwd = "/home/dev/project";
const roleCase = (tool, input, options) => subagentToolBlock(tool, input, repoCwd, options);

test("the role matrix refuses a write tool a role does not have", () => {
  assert.match(roleCase("edit", { path: "src/a.js" }, { role: "explorer" }), /explorer no escribe/);
  assert.match(roleCase("write", { path: "src/a.js" }, { role: "reviewer" }), /reviewer no escribe/);
  assert.equal(roleCase("write", { path: "src/a.js", content: "x" }, { role: "worker", surfaces: ["src"] }), null);
});

test("a worker without surfaces cannot write, even with the tool", () => {
  assert.match(roleCase("write", { path: "src/a.js", content: "x" }, { role: "worker" }), /sin superficies/);
});

test("the explorer reads the repo, its scratch and only the granted prefixes", () => {
  assert.equal(roleCase("read", { path: "src/a.js" }, { role: "explorer" }), null);
  assert.equal(roleCase("read", { path: `${repoCwd}/src/a.js` }, { role: "explorer" }), null);
  assert.equal(roleCase("grep", { pattern: "x", path: "src" }, { role: "explorer" }), null);
  assert.equal(roleCase("read", { path: "/etc/passwd" }, {}), null, "no role means the old behaviour");
  assert.match(roleCase("read", { path: "/etc/passwd" }, { role: "explorer" }), /queda fuera/);
  assert.equal(
    roleCase("read", { path: "/home/tachii/dev/gentle-shell/lib/a.ts" }, { role: "explorer", readOutside: ["/home/tachii/dev/gentle-shell"] }),
    null,
    "a mission can grant a prefix",
  );
  assert.match(
    roleCase("read", { path: "/home/tachii/notes/private.md" }, { role: "explorer", readOutside: ["/home/tachii/dev/gentle-shell"] }),
    /queda fuera/,
  );
});

test("a worker reads its own scratch but not the user's home", () => {
  const scratch = "/home/tachii/.po-shell/tmp/po-shell-sub-abc";
  assert.equal(roleCase("read", { path: `${scratch}/probe.js` }, { role: "worker", scratch }), null);
  assert.match(roleCase("read", { path: "/home/tachii/some-file" }, { role: "worker", scratch }), /queda fuera/);
});

test("only the explorer gets the web, and only the reviewer and worker run bash", () => {
  assert.equal(roleCase("web_search", { query: "x" }, { role: "explorer" }), null);
  assert.match(roleCase("web_search", { query: "x" }, { role: "worker" }), /no tiene acceso a la web/);
  assert.match(roleCase("bash", { command: "npm test" }, { role: "explorer" }), /no ejecuta comandos/);
  assert.equal(roleCase("bash", { command: "npm test" }, { role: "reviewer", scratch: "/tmp/x" }), null);
});

test("an unknown role is refused instead of falling back to worker", () => {
  assert.match(roleCase("read", { path: "src/a.js" }, { role: "planner" }), /unknown subagent role/);
});
