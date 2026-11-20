import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "skills");

function skillDirs() {
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name));
}

test("cada skill tiene frontmatter name/description válido", () => {
  for (const dir of skillDirs()) {
    const file = path.join(dir, "SKILL.md");
    assert.ok(fs.existsSync(file), `${dir} no tiene SKILL.md`);
    const text = fs.readFileSync(file, "utf8");
    const match = text.match(/^---\n([\s\S]*?)\n---/);
    assert.ok(match, `${file} no tiene frontmatter`);
    const name = match[1].match(/^name: (.+)$/m)?.[1];
    const description = match[1].match(/^description: (.+)$/m)?.[1];
    assert.equal(name, path.basename(dir));
    assert.ok(description && description.length <= 1024, `${file} description inválida`);
  }
});

test("el body de cada skill queda bajo 500 líneas", () => {
  for (const dir of skillDirs()) {
    const text = fs.readFileSync(path.join(dir, "SKILL.md"), "utf8");
    assert.ok(text.split("\n").length < 500, `${dir}/SKILL.md excede 500 líneas`);
  }
});
