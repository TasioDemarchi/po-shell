#!/usr/bin/env node
// Document consistency check. Exit 1 when something a test cannot see is wrong.
import { checkDocs, formatProblems } from "../src/doc-checks.js";

const cwd = process.argv[2] ?? process.cwd();
const { problems, known, checked } = checkDocs(cwd);
const lines = formatProblems(problems);

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ checked, problems, known }, null, 2));
} else if (lines.length) {
  for (const line of lines) console.log(line);
} else {
  const debt = known.length ? ` · ${known.length} known debt` : "";
  console.log(`docs ok · ${checked} files${debt}`);
}

process.exit(problems.length ? 1 : 0);
