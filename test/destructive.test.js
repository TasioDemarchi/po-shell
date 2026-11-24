import test from "node:test";
import assert from "node:assert/strict";
import { GUARD_KEYS, recognizeDestructive } from "../src/destructive.js";

const keys = (command) => recognizeDestructive(command).map((match) => match.key);
const first = (command) => recognizeDestructive(command)[0];

test("recognizes recursive removal and marks catastrophic targets as hard denies", () => {
  for (const command of ["rm -rf /", "rm -rf /*", "rm -r -f ~/*", "/bin/rm -rf /", "env rm -rf /", "rm --recursive /", "rm -rf //", "rm -rf /.", "rm -rf /./"]) {
    const match = first(command);
    assert.equal(match?.key, "rmRecursive", command);
    assert.equal(match?.hardDeny, true, command);
  }
});

test("a scoped recursive removal is reported but not a hard deny", () => {
  const match = first("rm -rf build/ dist/");
  assert.equal(match?.key, "rmRecursive");
  assert.equal(match?.hardDeny, false);
  assert.deepEqual(match?.targets, ["build/", "dist/"]);
  assert.equal(first("rm -rf ./build")?.hardDeny, false);
});

test("looks through shells, eval, find -exec and substitutions", () => {
  assert.deepEqual(keys('sh -c "rm -rf /"'), ["rmRecursive"]);
  assert.deepEqual(keys("bash -lc 'git reset --hard'"), ["gitResetHard"]);
  assert.deepEqual(keys('eval "rm -rf /"'), ["rmRecursive"]);
  assert.deepEqual(keys('find . -name "*.log" -exec rm -rf {} ;'), ["rmRecursive"]);
  assert.deepEqual(keys("echo $(git reset --hard)"), ["gitResetHard"]);
  assert.deepEqual(keys("echo `rm -rf build`"), ["rmRecursive"]);
});

test("recognizes destructive git operations", () => {
  assert.deepEqual(keys("git reset --hard"), ["gitResetHard"]);
  assert.deepEqual(keys("git -C repo reset --hard"), ["gitResetHard"]);
  assert.deepEqual(keys("git clean -fdx"), ["gitCleanForce"]);
  assert.deepEqual(keys("git checkout -- ."), ["gitCheckoutOverwrite"]);
  assert.deepEqual(keys("git branch -D main"), ["gitBranchDelete"]);
  assert.deepEqual(keys("git push origin +main"), ["gitPushForce"]);
  assert.deepEqual(keys("git -C . push --force"), ["gitPushForce"]);
  assert.deepEqual(keys("git rebase main"), ["gitRebase"]);
  assert.deepEqual(keys("git stash drop"), ["gitStashDrop"]);
  assert.deepEqual(keys("git branch -d merged"), []);
  assert.deepEqual(keys("git status"), []);
});

test("recognizes destructive SQL and disk writes", () => {
  assert.deepEqual(keys('sqlite3 po.db "DROP TABLE users"'), ["destructiveSql"]);
  assert.deepEqual(keys('psql -c "TRUNCATE events"'), ["destructiveSql"]);
  assert.deepEqual(keys('mysql -e "DELETE FROM users"'), ["destructiveSql"]);
  assert.deepEqual(keys('mysql -e "DELETE FROM users WHERE id = 1"'), []);
  assert.equal(first("mkfs.ext4 /dev/sdb1")?.hardDeny, true);
  assert.equal(first("dd if=/dev/zero of=/dev/sda")?.hardDeny, true);
  assert.deepEqual(keys("find / -delete"), ["findDelete"]);
});

test("data that only mentions a destructive command is not a command", () => {
  assert.deepEqual(keys('echo "rm -rf /" >> notes.txt'), []);
  assert.deepEqual(keys('cat <<EOF\nrm -rf /\nEOF'), []);
  assert.deepEqual(keys("grep -rn 'git reset --hard' docs/"), []);
  assert.deepEqual(keys("git commit -m 'docs: explain rm -rf /'"), []);
});

test("survives malformed input and stops at the nesting limit", () => {
  assert.deepEqual(recognizeDestructive(""), []);
  assert.deepEqual(recognizeDestructive("   "), []);
  assert.deepEqual(recognizeDestructive("echo '"), []);
  assert.deepEqual(keys("sh -c \"sh -c 'rm -rf /'\""), ["rmRecursive"]);

  let nested = "rm -rf /";
  for (let level = 0; level < 6; level++) nested = `sh -c ${JSON.stringify(nested)}`;
  assert.deepEqual(recognizeDestructive(nested), []);
});


test("guard keys are the documented set", () => {
  assert.ok(GUARD_KEYS.includes("rmRecursive"));
  assert.ok(GUARD_KEYS.includes("gitPushForce"));
  assert.equal(GUARD_KEYS.length, 11);
});
