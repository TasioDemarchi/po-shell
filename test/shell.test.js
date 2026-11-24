import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildPiArgs, cleanPiEnv, ensureProject, launch, providerDiagnostics, resolvePi, EXTENSION, SKILLS, PROTOCOL } from "../src/shell.js";

test("buildPiArgs loads extension, skills and protocol", () => {
  const args = buildPiArgs();
  assert.deepEqual(args, [
    "--extension",
    EXTENSION,
    ...SKILLS.flatMap((skill) => ["--skill", skill]),
    "--append-system-prompt",
    PROTOCOL,
  ]);
});

test("buildPiArgs passes Pi arguments and strips a leading --", () => {
  assert.deepEqual(buildPiArgs(["--", "--model", "x"]).slice(-2), ["--model", "x"]);
});

test("SKILLS includes the workflow and authoring skills", () => {
  assert.equal(SKILLS.length, 4);
  for (const skill of SKILLS) assert.ok(fs.existsSync(skill));
});

test("resolvePi honors PO_SHELL_PI_BIN", () => {
  const resolved = resolvePi({ PO_SHELL_PI_BIN: "/bin/echo" });
  assert.equal(resolved.command, "/bin/echo");
  assert.equal(resolved.source, "PO_SHELL_PI_BIN");
});


test("providerDiagnostics reads providers and defaults from the agent dir", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "po-shell-agent-"));
  fs.writeFileSync(
    path.join(dir, "models.json"),
    JSON.stringify({ providers: { nan: { baseUrl: "https://api.nan.builders/v1" } } }),
  );
  fs.writeFileSync(
    path.join(dir, "settings.json"),
    JSON.stringify({ defaultProvider: "nan", defaultModel: "glm5.3-flash" }),
  );
  const info = providerDiagnostics({ PI_CODING_AGENT_DIR: dir });
  assert.deepEqual(info.providers, ["nan"]);
  assert.equal(info.defaultProvider, "nan");
  assert.equal(info.defaultModel, "glm5.3-flash");
});


test("cleanPiEnv removes inherited Pi and Violeta state", () => {
  const clean = cleanPiEnv({
    PATH: "/bin",
    PI_CODING_AGENT_DIR: "/home/me/.violeta-test/agent",
    PI_SESSION_FILE: "/tmp/session.jsonl",
    PI_MODEL: "violeta-model",
    VIOLETA_HOME: "/home/me/.violeta-test",
    PO_SHELL_PI_BIN: "/bin/pi",
  });
  assert.equal(clean.PATH, "/bin");
  assert.equal(clean.PO_SHELL_PI_BIN, "/bin/pi");
  assert.equal(clean.PI_CODING_AGENT_DIR, undefined);
  assert.equal(clean.PI_SESSION_FILE, undefined);
  assert.equal(clean.PI_MODEL, undefined);
  assert.equal(clean.VIOLETA_HOME, undefined);
});

test("cleanPiEnv supports an explicit agent dir and escape hatch", () => {
  assert.equal(
    cleanPiEnv({ PO_SHELL_PI_AGENT_DIR: "/home/me/.pi/agent" }).PI_CODING_AGENT_DIR,
    "/home/me/.pi/agent",
  );
  assert.equal(
    cleanPiEnv({ PO_SHELL_KEEP_PI_ENV: "1", PI_MODEL: "x" }).PI_MODEL,
    "x",
  );
});


test("launch creates a session scratch, passes TMPDIR to Pi and cleans it", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "po-shell-launch-"));
  const home = path.join(dir, "home");
  const out = path.join(dir, "tmpdir.txt");
  const fake = path.join(dir, "fake-pi");
  fs.writeFileSync(fake, `#!/bin/sh\nprintf '%s' "$TMPDIR" > "${out}"\n`);
  fs.chmodSync(fake, 0o755);
  const code = await launch({
    cwd: dir,
    env: {
      ...process.env,
      PO_SHELL_HOME: home,
      PO_SHELL_CONTEXT_DB: path.join(dir, "context.db"),
      PO_SHELL_TMP_ROOT: path.join(home, "tmp"),
      PO_SHELL_PI_BIN: fake,
    },
  });
  assert.equal(code, 0);
  const childTmp = fs.readFileSync(out, "utf8");
  assert.ok(childTmp.startsWith(path.join(home, "tmp")));
  assert.equal(fs.existsSync(childTmp), false);
});


test("ensureProject initializes state automatically and leaves it healthy", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "po-shell-ensure-"));
  const env = {
    ...process.env,
    PO_SHELL_HOME: path.join(dir, "home"),
    PO_SHELL_CONTEXT_DB: path.join(dir, "context.db"),
  };
  const result = ensureProject(dir, env);
  assert.equal(result.ok, true);
  assert.equal(result.initialized, true);
  assert.equal(result.report.errors, 0);
  assert.ok(fs.existsSync(path.join(dir, "home", "projects", result.report.project.id, "config.json")));
});

test("ensureProject refuses an invalid task before opening the chat", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "po-shell-ensure-bad-"));
  const env = {
    ...process.env,
    PO_SHELL_HOME: path.join(dir, "home"),
    PO_SHELL_CONTEXT_DB: path.join(dir, "context.db"),
  };
  const first = ensureProject(dir, env);
  const tasks = path.join(dir, "home", "projects", first.report.project.id, "tasks");
  fs.writeFileSync(path.join(tasks, "bad.json"), "{not json");
  const result = ensureProject(dir, env);
  assert.equal(result.ok, false);
  assert.ok(result.report.errors >= 1);
});
