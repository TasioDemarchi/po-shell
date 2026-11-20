#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { projectStateDir } from "../src/project.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, "fixture");
const workRoot = path.join(here, "work");
const tasks = ["01-small", "02-medium", "03-risky"];

const args = process.argv.slice(2);
const reset = args.includes("--reset");
const requested = args.filter((arg) => !arg.startsWith("--"));
const selected = requested.length ? requested : tasks;

function prepare(task) {
  const dest = path.join(workRoot, task);
  if (fs.existsSync(dest)) {
    if (!reset) {
      console.log(`skip    ${task} (ya existe; usá --reset)`);
      return;
    }
    fs.rmSync(dest, { recursive: true, force: true });
  }

  if (reset) {
    const stateDir = projectStateDir(dest);
    fs.rmSync(stateDir, { recursive: true, force: true });
    console.log(`reset   estado central ${stateDir}`);
  }

  fs.mkdirSync(workRoot, { recursive: true });
  fs.cpSync(fixture, dest, { recursive: true });
  const git = (args) => {
    const result = spawnSync("git", args, { cwd: dest, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  };
  git(["init", "-q"]);
  git(["config", "user.email", "bench@plain.local"]);
  git(["config", "user.name", "Plain Bench"]);
  git(["add", "."]);
  git(["commit", "-qm", "fixture: baseline"]);
  console.log(`ready   ${task} → ${dest}`);
}

for (const task of selected) {
  if (!tasks.includes(task)) {
    console.error(`tarea desconocida: ${task}. Usá: ${tasks.join(", ")}`);
    process.exitCode = 1;
    continue;
  }
  prepare(task);
}
