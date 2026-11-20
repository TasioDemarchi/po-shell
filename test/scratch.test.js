import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  cleanupSessionScratch,
  createSessionScratch,
  createSubagentScratch,
  listScratch,
  scratchEnvironment,
  sweepScratch,
} from "../src/scratch.js";
import { testScratchViolation } from "../src/scratch-guard.js";
import { DEFAULT_POLICY, evaluateToolCall } from "../src/policy.js";

function envFor() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "plain-scratch-home-"));
  return { PLAIN_HOME: home, PLAIN_TMP_ROOT: path.join(home, "tmp") };
}

test("creates a private session scratch and points TMPDIR at it", () => {
  const env = envFor();
  const scratch = createSessionScratch(env, { cwd: "/tmp/project" });
  assert.ok(fs.existsSync(scratch.dir));
  assert.equal(scratch.env.TMPDIR, scratch.dir);
  assert.equal(scratch.env.PLAIN_TMP, scratch.dir);
  assert.ok(fs.existsSync(scratch.ledgerPath));
  assert.equal(listScratch(env).length, 1);
  assert.equal(cleanupSessionScratch(scratch), true);
  assert.ok(!fs.existsSync(scratch.dir));
  assert.equal(listScratch(env).length, 0);
});

test("subagent scratch nests under the session scratch and cleans only itself", () => {
  const env = envFor();
  const session = createSessionScratch(env);
  const child = createSubagentScratch({ ...env, PLAIN_TMP: session.dir });
  assert.ok(child.dir.startsWith(`${session.dir}${path.sep}`));
  assert.equal(child.env.TMPDIR, child.dir);
  assert.equal(child.cleanup(), true);
  assert.ok(!fs.existsSync(child.dir));
  assert.ok(fs.existsSync(session.dir));
  cleanupSessionScratch(session);
});

test("sweep keeps a live session and removes an old ended one", () => {
  const env = envFor();
  const live = createSessionScratch(env);
  const ended = createSessionScratch(env);

  const ledger = JSON.parse(fs.readFileSync(ended.ledgerPath, "utf8"));
  ledger.pid = 999_999;
  ledger.startedAt = new Date(0).toISOString();
  fs.writeFileSync(ended.ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);

  const result = sweepScratch(env, { graceMs: 0 });
  assert.equal(result.removed.length, 1);
  assert.equal(result.kept.length, 1);
  assert.ok(fs.existsSync(live.dir));
  assert.ok(!fs.existsSync(ended.dir));
  cleanupSessionScratch(live);
});

test("scratch cleanup refuses paths that are not runtime scratch names", () => {
  const env = envFor();
  const root = path.resolve(env.PLAIN_TMP_ROOT);
  fs.mkdirSync(path.join(root, "plain-not-valid"), { recursive: true });
  assert.equal(
    cleanupSessionScratch({
      scratchDir: path.join(root, "plain-not-valid"),
      tempRoot: root,
      ledgerPath: path.join(root, "ledger", "missing.json"),
    }),
    false,
  );
  assert.ok(fs.existsSync(path.join(root, "plain-not-valid")));
});

test("scratchEnvironment sets TMP and TEMP on Windows", () => {
  assert.deepEqual(scratchEnvironment("C:\\tmp\\plain-abc", "win32"), {
    TMPDIR: "C:\\tmp\\plain-abc",
    TMP: "C:\\tmp\\plain-abc",
    TEMP: "C:\\tmp\\plain-abc",
  });
});

test("test scratch guard blocks TMPDIR inside the working tree", () => {
  const blocked = testScratchViolation({
    toolName: "write",
    cwd: "/repo",
    input: {
      path: "test/tmp.test.js",
      content: 'const env = { TMPDIR: path.join(process.cwd(), ".tmp") };',
    },
  });
  assert.match(blocked ?? "", /TMPDIR/);
  assert.equal(
    evaluateToolCall({
      toolName: "write",
      cwd: "/repo",
      policy: DEFAULT_POLICY,
      input: {
        path: "test/tmp.test.js",
        content: 'const env = { TMPDIR: path.join(process.cwd(), ".tmp") };',
      },
    }).block,
    true,
  );
  assert.equal(
    testScratchViolation({
      toolName: "write",
      cwd: "/repo",
      input: {
        path: "test/tmp.test.js",
        content: "const env = { TMPDIR: os.tmpdir() };",
      },
    }),
    null,
  );
  assert.equal(
    testScratchViolation({
      toolName: "write",
      cwd: "/repo",
      input: {
        path: "src/tmp.js",
        content: 'const env = { TMPDIR: path.join(process.cwd(), ".tmp") };',
      },
    }),
    null,
  );
});
