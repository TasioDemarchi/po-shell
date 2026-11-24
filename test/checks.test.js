import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyChecks, suggestChecks } from "../src/checks.js";
import { loadConfig } from "../src/kernel.js";

process.env.PO_SHELL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "po-shell-checks-home-"));

function tempProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "po-shell-checks-"));
}

test("suggests npm scripts", () => {
  const dir = tempProject();
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ scripts: { test: "node --test", lint: "eslint ." } }),
  );
  fs.writeFileSync(path.join(dir, "package-lock.json"), "{}");
  const result = suggestChecks(dir);
  assert.deepEqual(result.commands, ["npm test", "npm run lint"]);
});

test("uses pnpm when the lockfile says so", () => {
  const dir = tempProject();
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ scripts: { test: "vitest" } }));
  fs.writeFileSync(path.join(dir, "pnpm-lock.yaml"), "");
  assert.deepEqual(suggestChecks(dir).commands, ["pnpm test"]);
});

test("suggests Go checks", () => {
  const dir = tempProject();
  fs.writeFileSync(path.join(dir, "go.mod"), "module example.com/x\n");
  assert.deepEqual(suggestChecks(dir).commands, ["go test ./...", "go vet ./..."]);
});

test("applies suggestions without duplicating existing checks", () => {
  const dir = tempProject();
  fs.writeFileSync(path.join(dir, "Cargo.toml"), "[package]\nname='x'\n");
  const checks = applyChecks(dir, ["cargo test"]);
  assert.deepEqual(checks, ["cargo test"]);
  assert.deepEqual(loadConfig(dir).checks, ["cargo test"]);
});
