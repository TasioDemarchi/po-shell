#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const [task, workdirArg] = process.argv.slice(2);
const tasks = ["01-small", "02-medium", "03-risky"];

if (!task || !tasks.includes(task)) {
  console.error(`uso: node bench/accept.mjs <${tasks.join("|")}> [workdir]`);
  process.exit(1);
}

const workdir = path.resolve(workdirArg ?? path.join(here, "work", task));
if (!fs.existsSync(path.join(workdir, "src", "pricing.js"))) {
  console.error(`no encuentro ${path.join(workdir, "src/pricing.js")}`);
  process.exit(1);
}

const testFile = path.join(here, "acceptance", `${task}.test.js`);
const result = spawnSync(process.execPath, ["--test", testFile], {
  cwd: workdir,
  stdio: "inherit",
  env: { ...process.env, BENCH_WORKDIR: workdir },
});
process.exit(result.status ?? 1);
