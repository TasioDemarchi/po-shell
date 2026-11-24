import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildSubagentArgs, capReport, runPiJson, usageTotal } from "../src/delegate.js";
import { init, saveAgentArtifact } from "../src/kernel.js";

process.env.PO_SHELL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "po-shell-delegate-home-"));

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function fakePi(dir, body) {
  const file = path.join(dir, "fake-pi");
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`);
  fs.chmodSync(file, 0o755);
  return file;
}

function envFor(file) {
  return { ...process.env, PO_SHELL_PI_BIN: file };
}

test("buildSubagentArgs isolates the child from global context", () => {
  const args = buildSubagentArgs({
    guardPath: "/p/guard.ts",
    promptPath: "/p/subagent.md",
    tools: ["read", "grep"],
    model: "nan/glm5.3-flash",
    mission: "map the repo",
  });
  assert.ok(args.includes("--no-context-files"));
  assert.ok(args.includes("--no-extensions"));
  assert.ok(args.includes("--no-skills"));
  assert.ok(args.includes("--no-mcp"));
  assert.ok(args.includes("--extension"));
  assert.ok(args.includes("--append-system-prompt"));
  assert.equal(args.at(-1), "map the repo");
  assert.ok(args.includes("nan/glm5.3-flash"));
});

test("runPiJson captures final text, usage and turns", async () => {
  const dir = tempDir("po-shell-delegate-");
  const fake = fakePi(
    dir,
    [
      `printf '%s\\n' '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"hola"}],"usage":{"input":10,"output":2,"totalTokens":12}}}'`,
      `printf '%s\\n' '{"type":"turn_end"}'`,
      `printf '%s\\n' '{"type":"agent_settled","aborted":false}'`,
      "exit 0",
    ].join("\n"),
  );

  const result = await runPiJson(dir, [], { env: envFor(fake), timeoutMs: 5000 });
  assert.equal(result.status, "ok");
  assert.equal(result.text, "hola");
  assert.equal(result.turns, 1);
  assert.equal(usageTotal(result.usage), 12);
});

test("runPiJson accumulates usage across assistant messages", async () => {
  const dir = tempDir("po-shell-delegate-");
  const fake = fakePi(
    dir,
    [
      `printf '%s\n' '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"uno"}],"usage":{"input":10,"output":2,"cacheRead":3,"cacheWrite":1,"totalTokens":16}}}'`,
      `printf '%s\n' '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"dos"}],"usage":{"input":20,"output":4,"cacheRead":5,"cacheWrite":0,"totalTokens":29}}}'`,
      "exit 0",
    ].join("\n"),
  );

  const result = await runPiJson(dir, [], { env: envFor(fake), timeoutMs: 5000 });
  assert.equal(result.totalUsage.input, 30);
  assert.equal(result.totalUsage.output, 6);
  assert.equal(result.totalUsage.cacheRead, 8);
  assert.equal(usageTotal(result.totalUsage), 45);
});

test("runPiJson passes an explicit child TMPDIR", async () => {
  const dir = tempDir("po-shell-delegate-");
  const out = path.join(dir, "tmpdir.txt");
  const fake = fakePi(
    dir,
    `printf '%s' "$TMPDIR" > "${out}"`,
  );
  await runPiJson(dir, [], {
    env: { ...envFor(fake), PO_SHELL_TEST_OUT: out },
    tmpDir: path.join(dir, "child-tmp"),
    timeoutMs: 5000,
  });
  assert.equal(fs.readFileSync(out, "utf8"), path.join(dir, "child-tmp"));
});

test("runPiJson keeps partial text when the stream ends without message_end", async () => {
  const dir = tempDir("po-shell-delegate-");
  const fake = fakePi(
    dir,
    [
      `printf '%s\\n' '{"type":"message_start"}'`,
      `printf '%s\\n' '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"hola "}}'`,
      `printf '%s\\n' '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"mundo"}}'`,
      "exit 0",
    ].join("\n"),
  );

  const result = await runPiJson(dir, [], { env: envFor(fake), timeoutMs: 5000 });
  assert.equal(result.status, "ok");
  assert.equal(result.text, "hola mundo");
});

test("runPiJson stops when max_tokens is exceeded", async () => {
  const dir = tempDir("po-shell-delegate-");
  const fake = fakePi(
    dir,
    [
      `printf '%s\\n' '{"type":"message_update","usage":{"input":50,"output":1,"totalTokens":51}}'`,
      "sleep 1",
      "exit 0",
    ].join("\n"),
  );

  const result = await runPiJson(dir, [], {
    env: envFor(fake),
    maxTokens: 20,
    timeoutMs: 5000,
  });
  assert.equal(result.status, "budget_exceeded");
  assert.equal(result.budgetExceeded, true);
});

test("runPiJson stops when max_turns is reached", async () => {
  const dir = tempDir("po-shell-delegate-");
  const fake = fakePi(
    dir,
    [
      `printf '%s\\n' '{"type":"turn_end"}'`,
      "sleep 1",
      "exit 0",
    ].join("\n"),
  );

  const result = await runPiJson(dir, [], {
    env: envFor(fake),
    maxTurns: 1,
    timeoutMs: 5000,
  });
  assert.equal(result.status, "turns_exceeded");
  assert.equal(result.turnsExceeded, true);
});

test("saveAgentArtifact writes meta, result and events", () => {
  const dir = tempDir("po-shell-agent-");
  init(dir);
  const artifact = saveAgentArtifact(dir, {
    id: "run-test",
    output: "resultado del subagente",
    events: [{ type: "message_end" }],
    meta: { role: "explorer", status: "ok" },
  });

  assert.ok(fs.existsSync(artifact.metaPath));
  assert.ok(fs.existsSync(artifact.resultPath));
  assert.ok(fs.existsSync(artifact.eventsPath));
  assert.match(fs.readFileSync(artifact.resultPath, "utf8"), /resultado del subagente/);
  assert.equal(JSON.parse(fs.readFileSync(artifact.metaPath, "utf8")).role, "explorer");
});

test("the child receives a common protocol plus its role contract", () => {
  const base = buildSubagentArgs({ guardPath: "guard", promptPath: "base.md", tools: ["read"], mission: "m" });
  const prompts = base.flatMap((arg, index) => (arg === "--append-system-prompt" ? [base[index + 1]] : []));
  assert.deepEqual(prompts, ["base.md"]);

  const withRole = buildSubagentArgs({
    guardPath: "guard",
    promptPath: "base.md",
    rolePath: "prompts/subagents/explore.md",
    tools: ["read"],
    mission: "m",
  });
  const rolePrompts = withRole.flatMap((arg, index) => (arg === "--append-system-prompt" ? [withRole[index + 1]] : []));
  assert.deepEqual(rolePrompts, ["base.md", "prompts/subagents/explore.md"]);
});

test("a report that fits is delivered unchanged", () => {
  const capped = capReport("short report", { maxBytes: 1024 });
  assert.equal(capped.text, "short report");
  assert.equal(capped.truncated, false);
  assert.equal(capped.deliveredBytes, capped.bytes);
});

test("a long report keeps head and tail and points at the artifact", () => {
  const head = "HEAD-LINE\n".repeat(800);
  const tail = "TAIL-CONCLUSION\n";
  const capped = capReport(`${head}${tail}`, { maxBytes: 4096, artifactPath: "/state/agents/run-1/result.md" });
  assert.equal(capped.truncated, true);
  assert.ok(capped.deliveredBytes <= 4096 + 400);
  assert.match(capped.text, /^HEAD-LINE/);
  assert.match(capped.text, /\[po-shell\] report truncated: \d+ of \d+ bytes delivered\./);
  assert.match(capped.text, /\/state\/agents\/run-1\/result\.md/);
  assert.match(capped.text, /TAIL-CONCLUSION/);
  assert.ok(!capped.text.includes("\uFFFD"));
});

test("a JSON report is never cut", () => {
  const json = JSON.stringify({ findings: Array.from({ length: 2000 }, (_, index) => ({ index, text: "x" })) });
  assert.ok(json.length > 4096);
  const capped = capReport(json, { maxBytes: 4096 });
  assert.equal(capped.truncated, false);
  assert.equal(capped.text, json);
});
