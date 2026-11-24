// Lexical recognizer for destructive shell commands.
//
// It is not a shell interpreter and it is not a sandbox: it tokenizes the forms
// that can actually run, skips wrappers and recurses into a bounded set of
// nested payloads. Nothing here decides policy: it reports matches and
// src/policy.js maps each key to allow | confirm | block.
//
// Ported from gentle-shell's destructive-command-guard.ts, reduced to the keys
// po-shell can act on. A missing entry costs a confirmation, never a bypass:
// hard denies are also blocked by src/policy.js denyCommands.

const SEPARATORS = new Set([";", ";;", "&&", "||", "|", "&", "\n", "(", ")"]);
const TOKEN_RE = /(?:"(?:\\.|[^"\\])*"|'[^']*'|\\.|[^\s;&|()'"\\])+|&&|\|\||;;|[;&|()\n]/g;

const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh"]);
const SQL_CLIENTS = new Set(["sqlite3", "psql", "mysql", "mariadb", "duckdb"]);
const RESERVED = new Set(["if", "then", "elif", "else", "do", "while", "until", "{", "!", "time"]);
const WRAPPERS = new Set(["env", "sudo", "command", "exec", "nohup", "timeout", "xargs", "nice", "ionice", "stdbuf"]);
const WRAPPER_VALUE_FLAGS = {
  env: ["-u", "--unset", "-C", "--chdir", "-S", "--split-string"],
  sudo: [
    "-u", "--user", "-g", "--group", "-p", "--prompt", "-C", "--close-from",
    "-D", "--chdir", "-h", "--host", "-r", "--role", "-t", "--type",
  ],
  timeout: ["-s", "--signal", "-k", "--kill-after"],
  xargs: ["-n", "--max-args", "-I", "--replace", "-P", "--max-procs", "-d", "--delimiter", "-L", "--max-lines", "-s", "--max-chars"],
  nice: ["-n", "--adjustment"],
  ionice: ["-c", "--class", "-n", "--classdata", "-p", "--pid"],
  stdbuf: ["-i", "-o", "-e"],
};
const GIT_VALUE_FLAGS = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace"]);

// Literal targets that make a recursive rm catastrophic regardless of policy.
const ROOT_TARGETS = [
  /^\/+(?:\.{0,2})?\/*$/,
  /^\/+\*+$/,
  /^~\/?$/,
  /^~\/\*+$/,
  /^\$HOME\/?$/,
  /^\$\{HOME\}\/?$/,
  /^\.{1,2}\/?$/,
  /^\.{1,2}\/\*+$/,
];

const DESTRUCTIVE_SQL = /(?:^|;)\s*(?:drop\s+(?:table|database|schema|index|view|trigger)|truncate\s+(?:table\s+)?[\w."`[])/i;

function unquote(raw) {
  return raw.replace(
    /"((?:\\.|[^"\\])*)"|'([^']*)'|\\(.)/g,
    (_match, double, single, escaped) =>
      double !== undefined ? double.replace(/\\(["\\$`])/g, "$1") : single !== undefined ? single : escaped ?? "",
  );
}

function tokenize(command) {
  const tokens = [];
  for (const match of command.matchAll(TOKEN_RE)) {
    const raw = match[0];
    const operator = SEPARATORS.has(raw);
    tokens.push({ raw, value: operator ? raw : unquote(raw), operator, index: match.index });
  }
  return tokens;
}

/** Heredoc bodies are data, never shell segments; offsets are preserved. */
function blankHeredocs(command) {
  return command.replace(/<<-?\s*(['"]?)([A-Za-z_]\w*)\1[^\n]*\n[\s\S]*?\n\s*\2(?=\n|$)/g, (raw) => {
    const bodyStart = raw.indexOf("\n") + 1;
    return raw.slice(0, bodyStart) + raw.slice(bodyStart).replace(/[^\n]/g, " ");
  });
}

function substitutions(command) {
  const bodies = [];
  for (const match of command.matchAll(/\$\(([^()]*)\)/g)) bodies.push(match[1]);
  for (const match of command.matchAll(/`([^`]*)`/g)) bodies.push(match[1]);
  return bodies;
}

const executable = (value) => value.split("/").at(-1) ?? value;

/** Index of the executable token after reserved words, assignments and wrappers. */
function headCursor(segment) {
  let cursor = 0;
  while (cursor < segment.length && segment[cursor].raw === segment[cursor].value && RESERVED.has(segment[cursor].value)) {
    cursor++;
  }
  while (cursor < segment.length) {
    const value = segment[cursor].value;
    if (/^[A-Za-z_][A-Za-z_0-9]*=/.test(value)) {
      cursor++;
      continue;
    }
    const name = executable(value);
    if (!WRAPPERS.has(name)) break;
    cursor++;
    while (cursor < segment.length && segment[cursor].value.startsWith("-")) {
      const flag = segment[cursor++].value;
      if (flag === "--") break;
      if (WRAPPER_VALUE_FLAGS[name]?.includes(flag)) cursor++;
    }
    if (name === "timeout") cursor++; // duration
  }
  return cursor;
}

function literalTargets(args) {
  const targets = [];
  let options = true;
  for (const arg of args) {
    if (options && arg === "--") options = false;
    else if (options && arg.startsWith("-")) continue;
    else targets.push(arg);
  }
  return targets;
}

function destructiveSql(payload) {
  return DESTRUCTIVE_SQL.test(payload) || /(?:^|;)\s*delete\s+from\b/i.test(payload) && !/\bwhere\b/i.test(payload);
}

function inspectSegment(segment, matches, depth) {
  const cursor = headCursor(segment);
  const head = segment[cursor];
  if (!head) return;
  const name = executable(head.value);
  const args = segment.slice(cursor + 1).map((token) => token.value);
  const add = (key, options = {}) => matches.push({ key, hardDeny: false, index: head.index, ...options });
  const nested = (payload) => {
    if (typeof payload !== "string" || !payload.trim()) return;
    for (const match of recognizeDestructive(payload, depth + 1)) matches.push({ ...match, index: head.index });
  };

  if (SHELLS.has(name)) {
    const flag = args.findIndex((arg) => /^-[a-z]*c[a-z]*$/.test(arg));
    if (flag >= 0) nested(args[flag + 1]);
  }

  if (name === "eval") nested(args.join(" "));

  if (name === "rm") {
    const recursive = args.some((arg) => /^-[^-]*[rR]/.test(arg) || arg === "--recursive");
    if (recursive) {
      const targets = literalTargets(args);
      const hard = targets.some((target) => ROOT_TARGETS.some((pattern) => pattern.test(target)));
      add("rmRecursive", { hardDeny: hard, targets });
    }
  }

  if (name === "find") {
    if (args.includes("-delete")) add("findDelete");
    for (let index = 0; index < args.length; index++) {
      if (!["-exec", "-execdir", "-ok", "-okdir"].includes(args[index])) continue;
      const rest = args.slice(index + 1);
      const end = rest.findIndex((arg) => arg === ";" || arg === "+");
      nested((end < 0 ? rest : rest.slice(0, end)).join(" "));
      if (end < 0) break;
      index += end + 1;
    }
  }

  if (name === "git") {
    let index = 0;
    while (args[index]?.startsWith("-")) {
      const flag = args[index++];
      if (GIT_VALUE_FLAGS.has(flag)) index++;
    }
    const action = args[index];
    const flags = args.slice(index + 1);
    const force = flags.some((arg) => /^--force(?:-with-lease)?(?:=|$)/.test(arg) || /^-[^-]*f/.test(arg));
    if (action === "reset" && flags.includes("--hard")) add("gitResetHard");
    if (action === "clean" && force) add("gitCleanForce");
    if (action === "checkout" && (force || flags.includes("--"))) add("gitCheckoutOverwrite");
    if (action === "restore") add("gitCheckoutOverwrite");
    if (action === "branch" && (flags.some((arg) => /^-[^-]*D/.test(arg)) || (force && flags.some((arg) => /^-[^-]*d/.test(arg) || arg === "--delete")))) {
      add("gitBranchDelete");
    }
    if (action === "push" && (force || flags.some((arg) => arg.startsWith("+")))) add("gitPushForce");
    if (action === "rebase") add("gitRebase");
    if (action === "stash" && ["drop", "clear"].includes(flags[0])) add("gitStashDrop");
  }

  if (SQL_CLIENTS.has(name)) {
    const payloads = args.map((arg) => arg.replace(/^(?:--command|--execute|-c|-e)=?/, ""));
    if (payloads.some(destructiveSql)) add("destructiveSql");
  }

  if (name === "mkfs" || name.startsWith("mkfs.")) add("diskWrite", { hardDeny: true });
  if (name === "dd" && args.some((arg) => arg.startsWith("of=/dev/"))) add("diskWrite", { hardDeny: true });
}

/**
 * Every destructive match in `command`, in textual order.
 * Nested payloads (sh -c, eval, find -exec, substitutions) are inspected up to
 * three levels deep; beyond that only the outer form counts.
 */
export function recognizeDestructive(command, depth = 0) {
  if (typeof command !== "string" || !command.trim() || depth > 3) return [];
  const matches = [];
  const tokens = tokenize(blankHeredocs(command));
  let start = 0;
  for (let end = 0; end <= tokens.length; end++) {
    if (end < tokens.length && !tokens[end].operator) continue;
    inspectSegment(tokens.slice(start, end), matches, depth);
    start = end + 1;
  }
  for (const body of substitutions(command)) {
    for (const match of recognizeDestructive(body, depth + 1)) matches.push({ ...match, index: 0 });
  }
  // A substitution inside a word is also visible to the tokenizer (`$(git` +
  // `reset`); keep one entry per key and target set.
  const seen = new Set();
  return matches.filter((match) => {
    const id = `${match.key}:${match.hardDeny}:${(match.targets ?? []).join(",")}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/** Keys a policy can configure, in the order they are documented. */
export const GUARD_KEYS = [
  "rmRecursive",
  "findDelete",
  "gitResetHard",
  "gitCleanForce",
  "gitCheckoutOverwrite",
  "gitBranchDelete",
  "gitRebase",
  "gitStashDrop",
  "gitPushForce",
  "destructiveSql",
  "diskWrite",
];
