#!/usr/bin/env node
// The CLI for the generated code map. The renderer lives in src/code-map.js so
// that `po-shell map` and this script share one implementation:
// `node scripts/code-map.mjs` prints the map to stdout, and `--check` fails when
// docs/code-map.md no longer matches the code.
import fs from "node:fs";
import path from "node:path";
import { MAP_FILE, firstDifference, renderMap } from "../src/code-map.js";

function main(argv) {
  const check = argv.includes("--check");
  const positional = argv.filter((arg) => !arg.startsWith("--"));
  const root = path.resolve(positional[0] ?? process.cwd());
  const map = renderMap(root);

  if (!check) {
    process.stdout.write(map);
    return 0;
  }

  const file = path.join(root, MAP_FILE);
  if (!fs.existsSync(file)) {
    console.error(`code-map: ${MAP_FILE} is missing; run npm run code:map`);
    return 1;
  }
  const committed = fs.readFileSync(file, "utf8");
  if (committed === map) {
    console.log(`code-map ok · ${MAP_FILE}`);
    return 0;
  }
  const difference = firstDifference(map, committed);
  console.error(`${MAP_FILE}:${difference.line} is stale; run npm run code:map`);
  console.error(`  expected: ${difference.expected}`);
  console.error(`  found:    ${difference.actual}`);
  return 1;
}

function isMain() {
  try {
    return Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(new URL(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) process.exit(main(process.argv.slice(2)));
