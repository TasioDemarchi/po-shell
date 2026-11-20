import fs from "node:fs";
import path from "node:path";
import { init, loadConfig, saveConfig } from "./kernel.js";
import { readJson } from "./util.js";

function packageManager(cwd) {
  if (fs.existsSync(path.join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(cwd, "yarn.lock"))) return "yarn";
  if (fs.existsSync(path.join(cwd, "bun.lockb")) || fs.existsSync(path.join(cwd, "bun.lock"))) {
    return "bun";
  }
  return "npm";
}

function runScript(pm, script) {
  if (script === "test") return pm === "bun" ? "bun test" : `${pm} test`;
  return pm === "bun" ? `bun run ${script}` : `${pm} run ${script}`;
}

export function suggestChecks(cwd = process.cwd()) {
  const commands = [];
  const reasons = [];
  const seen = new Set();
  const add = (command, reason) => {
    if (!command || seen.has(command)) return;
    seen.add(command);
    commands.push(command);
    reasons.push(reason);
  };
  const has = (file) => fs.existsSync(path.join(cwd, file));

  if (has("package.json")) {
    const pkg = readJson(path.join(cwd, "package.json"), {});
    const pm = packageManager(cwd);
    const scripts = pkg?.scripts ?? {};
    for (const name of ["test", "lint", "typecheck"]) {
      if (scripts[name]) add(runScript(pm, name), `package.json#scripts.${name} (${pm})`);
    }
  }

  if (has("go.mod")) {
    add("go test ./...", "go.mod");
    add("go vet ./...", "go.mod");
  }

  if (has("Cargo.toml")) {
    add("cargo test", "Cargo.toml");
    add("cargo clippy -- -D warnings", "Cargo.toml");
  }

  if (has("pyproject.toml") || has("pytest.ini") || has("tox.ini")) {
    add("pytest", "proyecto Python");
    const pyproject = has("pyproject.toml")
      ? fs.readFileSync(path.join(cwd, "pyproject.toml"), "utf8")
      : "";
    if (/\bruff\b/.test(pyproject)) add("ruff check .", "pyproject.toml menciona ruff");
    if (/\bmypy\b/.test(pyproject)) add("mypy .", "pyproject.toml menciona mypy");
  }

  if (has("pom.xml")) add("mvn test", "pom.xml");
  if (has("build.gradle")) add("./gradlew test", "build.gradle");
  if (has("build.gradle.kts")) add("./gradlew test", "build.gradle.kts");

  if (has("Makefile")) {
    const makefile = fs.readFileSync(path.join(cwd, "Makefile"), "utf8");
    if (/^test\s*:/m.test(makefile)) add("make test", "Makefile#test");
  }
  if (has("justfile") || has("Justfile")) add("just test", "justfile");

  return { commands: commands.slice(0, 10), reasons };
}

export function applyChecks(cwd, commands) {
  init(cwd);
  const config = loadConfig(cwd);
  const checks = [...new Set([...(config.checks ?? []), ...commands])];
  saveConfig(cwd, { checks });
  return checks;
}
