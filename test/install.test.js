import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  installMethod,
  installReport,
  postinstallReport,
  renderInstallReport,
  uninstallPlan,
  updatePlan,
} from "../src/install.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const script = path.join(root, "scripts", "install.mjs");
const temp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

test("installReport describes what is installed and never writes", () => {
  const stateHome = temp("po-shell-install-home-");
  const env = { ...process.env, PO_SHELL_HOME: stateHome };

  const report = installReport({ packageRoot: root, env });

  assert.equal(report.name, "po-shell");
  assert.match(report.version, /^\d+\.\d+\.\d+/);
  assert.equal(report.stateHome, stateHome);
  assert.ok(Array.isArray(report.checks) && report.checks.length > 0);
  assert.ok(report.checks.some((check) => check.name === "bin en PATH"));
  assert.ok(report.nextSteps.includes("Verificá todo: po-shell doctor"));
  assert.equal(typeof report.ok, "boolean");
  assert.deepEqual(fs.readdirSync(stateHome), [], "installReport must not create state");
});

test("installReport points at the exact Pi command when Pi is missing", () => {
  const stateHome = temp("po-shell-install-nopi-home-");
  const env = { ...process.env, PO_SHELL_HOME: stateHome, PO_SHELL_PI_BIN: "/nonexistent/pi" };

  const report = installReport({ packageRoot: root, env });

  assert.equal(report.ok, false);
  assert.ok(
    report.nextSteps.some((step) => step.includes("npm i -g @earendil-works/pi-coding-agent")),
  );
  assert.deepEqual(fs.readdirSync(stateHome), []);
});

test("renderInstallReport returns the right exit code", () => {
  const ok = {
    ok: true,
    name: "po-shell",
    version: "0.1.0",
    stateHome: "/tmp/x",
    checks: [{ name: "Node 22+", ok: true, detail: "v22", warn: false }],
    nextSteps: [],
  };
  assert.equal(renderInstallReport(ok), 0);
  const broken = {
    ...ok,
    ok: false,
    checks: [{ name: "Pi", ok: false, detail: "no", warn: false }],
    nextSteps: ["instalá Pi"],
  };
  assert.equal(renderInstallReport(broken), 1);
});

test("update and uninstall plans match the install method", () => {
  assert.deepEqual(updatePlan("npm"), { command: "npm", args: ["install", "-g", "po-shell@latest"] });
  assert.deepEqual(updatePlan("pnpm"), { command: "pnpm", args: ["add", "-g", "po-shell@latest"] });
  assert.deepEqual(updatePlan("link", { packageRoot: "/repo" }), {
    command: "npm",
    args: ["link"],
    cwd: "/repo",
  });
  assert.deepEqual(updatePlan("missing"), { command: "npm", args: ["install", "-g", "po-shell"] });

  assert.deepEqual(uninstallPlan("npm"), { command: "npm", args: ["uninstall", "-g", "po-shell"] });
  assert.deepEqual(uninstallPlan("pnpm"), { command: "pnpm", args: ["remove", "-g", "po-shell"] });
  assert.deepEqual(uninstallPlan("link"), { command: "npm", args: ["unlink", "-g", "po-shell"] });
  assert.equal(uninstallPlan("missing"), null);

  assert.ok(!JSON.stringify(uninstallPlan("npm")).includes(".po-shell"));
  assert.ok(!JSON.stringify(uninstallPlan("npm")).includes("home"));
});

test("installMethod reports missing and link without touching anything", () => {
  const emptyPath = temp("po-shell-install-empty-");
  assert.equal(installMethod({ env: { ...process.env, PATH: emptyPath } }).method, "missing");

  const packageRoot = temp("po-shell-install-root-");
  fs.mkdirSync(path.join(packageRoot, "bin"), { recursive: true });
  const target = path.join(packageRoot, "bin", "po-shell.js");
  fs.writeFileSync(target, "#!/usr/bin/env node\n");
  const linkDir = temp("po-shell-install-bin-");
  const link = path.join(linkDir, "po-shell");
  fs.symlinkSync(target, link);

  const detected = installMethod({ packageRoot, binPath: link });
  assert.equal(detected.method, "link");
  assert.equal(fs.realpathSync(link), fs.realpathSync(target));
});

test("postinstall never fails and stays silent when everything is fine", () => {
  const stateHome = temp("po-shell-postinstall-home-");
  const env = { ...process.env, PO_SHELL_HOME: stateHome };
  const result = spawnSync(process.execPath, [script, "--postinstall"], {
    encoding: "utf8",
    env,
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), "");
  assert.deepEqual(fs.readdirSync(stateHome), []);
});

test("postinstall still exits 0 when Pi is missing", () => {
  const stateHome = temp("po-shell-postinstall-nopi-");
  const result = spawnSync(process.execPath, [script, "--postinstall"], {
    encoding: "utf8",
    env: { ...process.env, PO_SHELL_HOME: stateHome, PO_SHELL_PI_BIN: "/nonexistent/pi" },
  });
  assert.equal(result.status, 0);
  assert.match(result.stderr, /npm i -g @earendil-works\/pi-coding-agent/);
});

test("install script reports json and exits 0 when the environment is ready", () => {
  const stateHome = temp("po-shell-install-json-");
  const result = spawnSync(process.execPath, [script, "--json"], {
    encoding: "utf8",
    env: { ...process.env, PO_SHELL_HOME: stateHome },
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.name, "po-shell");
  assert.equal(report.stateHome, stateHome);
  assert.deepEqual(fs.readdirSync(stateHome), []);
});

test("the installer rejects unknown flags instead of guessing", () => {
  const result = spawnSync(process.execPath, [script, "--install-everything"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /opción desconocida/);
});

test("postinstallReport returns the report without printing a secret", () => {
  const stateHome = temp("po-shell-postinstall-report-");
  const env = { ...process.env, PO_SHELL_HOME: stateHome, PO_SHELL_SEMANTIC_API_KEY: "nan_secret" };
  const report = postinstallReport({ packageRoot: root, env });
  const serialized = JSON.stringify(report);
  assert.ok(!serialized.includes("nan_secret"));
  assert.deepEqual(fs.readdirSync(stateHome), []);
});
