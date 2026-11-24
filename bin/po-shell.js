#!/usr/bin/env node
import { main } from "../src/cli.js";
import { doctor, launch } from "../src/shell.js";

const CLI_COMMANDS = new Set([
  "init",
  "where",
  "projects",
  "checks",
  "status",
  "events",
  "backup",
  "restore",
  "integrity",
  "scratch",
  "index",
  "context",
  "ask",
  "remember",
  "directives",
  "task",
  "memory",
  "check",
  "review",
  "policy",
  "config",
  "install",
  "update",
  "uninstall",
  "help",
]);

async function runCli(args) {
  try {
    await main(args);
  } catch (error) {
    console.error(`po-shell: ${error.message}`);
    process.exitCode = 1;
  }
}

const argv = process.argv.slice(2);
const first = argv[0];

if (!first) {
  process.exitCode = await launch();
} else if (first === "doctor") {
  process.exitCode = doctor();
} else if (first === "shell" || first === "run") {
  process.exitCode = await launch({ args: argv.slice(1) });
} else if (first === "help" || first === "--help" || first === "-h") {
  await runCli([first]);
} else if (CLI_COMMANDS.has(first)) {
  await runCli(argv);
} else if (first.startsWith("-")) {
  process.exitCode = await launch({ args: argv });
} else {
  await runCli(argv);
}
