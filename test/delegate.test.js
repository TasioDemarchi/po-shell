import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildSubagentArgs, runPiJson, usageTotal } from "../src/delegate.js";
import { init, saveAgentArtifact } from "../src/kernel.js";

process.env.PLAIN_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "plain-delegate-home-"));

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
  return { ...process.env, PLAIN_PI_BIN: file };
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
  const dir = tempDir("plain-delegate-");
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
  const dir = tempDir("plain-delegate-");
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

test("runPiJson keeps partial text when the stream ends without message_end", async () => {
  const dir = tempDir("plain-delegate-");
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
  const dir = tempDir("plain-delegate-");
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
  const dir = tempDir("plain-delegate-");
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
  const dir = tempDir("plain-agent-");
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
