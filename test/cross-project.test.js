import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getContext, searchContext } from "../src/context.js";
import { indexProject } from "../src/indexer.js";
import { init, saveMemory } from "../src/kernel.js";
import { projectIdentity } from "../src/project.js";

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function envFor(home) {
  return {
    PO_SHELL_HOME: home,
    PO_SHELL_CONTEXT_DB: path.join(home, "context.db"),
  };
}

function setupProject(dir, env) {
  init(dir, env);
  fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "docs", "requirements.md"),
    "# Requirements\n\n## Retries\n\nLos retries duplicaban registros.\n",
  );
  saveMemory(
    dir,
    {
      title: "Retries duplicados",
      what: "Reusar el request id.",
      why: "Los retries duplicaban registros.",
      where: "upload.go",
      learned: "El request id es estable.",
      type: "bugfix",
      scope: "project",
      topic: "bugfix/retries",
    },
    env,
  );
  return indexProject(dir, { env }).project;
}

test("falls back to other projects when the current project has no memory", async () => {
  const home = tempDir("po-shell-cross-home-");
  const projectA = tempDir("po-shell-cross-a-");
  const projectB = tempDir("po-shell-cross-b-");
  const env = envFor(home);
  const a = setupProject(projectA, env);
  init(projectB, env);

  const local = await searchContext(projectB, "duplicaban", { env });
  assert.equal(local.results.length, 1);
  assert.equal(local.results[0].kind, "memory");
  assert.equal(local.results[0].projectId, a.id);
  assert.equal(local.results[0].id, `mem:project:${a.id}:bugfix-retries`);
  assert.equal(local.results[0].source, "other");

  const all = await searchContext(projectB, "duplicaban", { env, allProjects: true });
  assert.equal(all.results.length, 1);
  assert.equal(all.results[0].id, `mem:project:${a.id}:bugfix-retries`);

  const specs = await searchContext(projectB, "duplicaban", {
    env,
    allProjects: true,
    kinds: ["spec"],
  });
  assert.deepEqual(specs.results, []);

  const full = getContext(projectB, all.results[0].id, { env });
  assert.match(full.content, /Los retries duplicaban/);
  assert.equal(full.projectId, a.id);
});


test("current project memories win over other projects", async () => {
  const home = tempDir("po-shell-cross-home-");
  const projectA = tempDir("po-shell-cross-a-");
  const projectB = tempDir("po-shell-cross-b-");
  const env = envFor(home);
  setupProject(projectA, env);
  init(projectB, env);
  saveMemory(
    projectB,
    {
      title: "Retries B",
      what: "Regla local del proyecto B.",
      why: "Los retries duplicaban en B.",
      type: "decision",
      scope: "project",
      topic: "local/b",
    },
    env,
  );

  const result = await searchContext(projectB, "duplicaban", { env });
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].projectId, projectIdentity(projectB).id);
  assert.equal(result.results[0].source, "current");
  assert.equal(result.requiresConfirmation, false);
});

test("explicit project search works from an unrelated cwd", async () => {
  const home = tempDir("po-shell-cross-home-");
  const projectA = tempDir("po-shell-cross-a-");
  const outside = tempDir("po-shell-cross-outside-");
  const env = envFor(home);
  const a = setupProject(projectA, env);

  const result = await searchContext(outside, "duplicaban", {
    env,
    project: projectA,
  });
  assert.equal(result.inProject, true);
  const memory = result.results.find((item) => item.kind === "memory");
  assert.ok(memory);
  assert.equal(memory.projectId, a.id);
});

test("does not index an uninitialized cwd", async () => {
  const home = tempDir("po-shell-cross-home-");
  const projectA = tempDir("po-shell-cross-a-");
  const outside = tempDir("po-shell-cross-outside-");
  const env = envFor(home);
  setupProject(projectA, env);
  fs.mkdirSync(path.join(outside, "docs"), { recursive: true });
  fs.writeFileSync(
    path.join(outside, "docs", "requirements.md"),
    "# Requirements\n\n## Retries\n\nLos retries duplicaban registros.\n",
  );

  const result = await searchContext(outside, "duplicaban", { env });
  assert.ok(result.results.every((item) => item.kind === "memory"));
  assert.equal(result.results[0].projectId, projectIdentity(projectA).id);
});
