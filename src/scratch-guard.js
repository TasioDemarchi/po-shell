const TEST_PATH_PATTERNS = [
  /(^|[\\/])(tests?|__tests__|spec)[\\/]/,
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /_test\.go$/,
  /(^|[\\/])test_[^\\/]*\.py$/,
];

const TMPDIR_ASSIGNMENT = /\bTMPDIR["']?\]?\s*(?::|=(?!=))\s*([^\n;,}]*)/g;
const WORKING_DIRECTORY =
  /\$PWD|\$\{PWD\}|\$\(pwd\)|process\.cwd\(\)|__dirname|import\.meta\.dirname|os\.getcwd\(\)/;
const RELATIVE_PATH = /^\s*["'`]?(?:\.{1,2}[\/\\\w-]|[\w.-]+[\/\\])/;

export function isTestFilePath(file) {
  return TEST_PATH_PATTERNS.some((pattern) => pattern.test(String(file ?? "").replace(/\\/g, "/")));
}

function writtenText(input = {}) {
  if (typeof input.content === "string") return input.content;
  const parts = [];
  if (typeof input.newText === "string") parts.push(input.newText);
  if (Array.isArray(input.edits)) {
    for (const edit of input.edits) {
      if (edit && typeof edit === "object" && typeof edit.newText === "string") parts.push(edit.newText);
    }
  }
  return parts.length ? parts.join("\n") : undefined;
}

export function testScratchViolation({ toolName, input = {}, cwd } = {}) {
  if (toolName !== "write" && toolName !== "edit") return null;
  const file = input.path ?? input.file_path ?? input.file;
  if (!file || !isTestFilePath(file)) return null;
  const text = writtenText(input);
  if (!text) return null;
  for (const match of text.matchAll(TMPDIR_ASSIGNMENT)) {
    if (WORKING_DIRECTORY.test(match[1]) || RELATIVE_PATH.test(match[1])) {
      return `TMPDIR apunta dentro del repositorio (${String(cwd ?? "cwd")}); usá mktemp fuera del worktree`;
    }
  }
  return null;
}
