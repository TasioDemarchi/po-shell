import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { PACKAGE_ROOT, diagnostics } from "./shell.js";
import { poShellHome } from "./project.js";

const PACKAGE_JSON = path.join(PACKAGE_ROOT, "package.json");

export function packageMeta(packageRoot = PACKAGE_ROOT) {
  const file = path.join(packageRoot, "package.json");
  try {
    const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
    return { name: pkg.name ?? "po-shell", version: pkg.version ?? "0.0.0", file };
  } catch {
    return { name: "po-shell", version: "0.0.0", file };
  }
}

export function whichBin(name, env = process.env) {
  const probe = spawnSync(process.platform === "win32" ? "where" : "which", [name], {
    encoding: "utf8",
    env,
  });
  if (probe.status !== 0) return null;
  return probe.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null;
}

/**
 * How this po-shell got here: a global npm install, a global pnpm install, or
 * `npm link` from a checkout. Detection never installs anything.
 */
export function installMethod({ env = process.env, packageRoot = PACKAGE_ROOT, binPath } = {}) {
  const bin = binPath ?? whichBin("po-shell", env);
  if (!bin) return { method: "missing", bin: null, target: null };

  let real = bin;
  try {
    real = fs.realpathSync(bin);
  } catch {
    // Un bin que no se puede resolver se trata como desconocido.
  }
  const packageBin = fs.existsSync(path.join(packageRoot, "bin", "po-shell.js"))
    ? fs.realpathSync(path.join(packageRoot, "bin", "po-shell.js"))
    : path.join(packageRoot, "bin", "po-shell.js");
  if (real === packageBin) return { method: "link", bin, target: real };

  const npmRoot = spawnSync("npm", ["root", "-g"], { encoding: "utf8", env });
  if (npmRoot.status === 0 && npmRoot.stdout.trim()) {
    const installed = path.join(npmRoot.stdout.trim(), "po-shell");
    if (fs.existsSync(installed)) return { method: "npm", bin, target: installed };
  }

  const pnpmRoot = spawnSync("pnpm", ["root", "-g"], { encoding: "utf8", env });
  if (pnpmRoot.status === 0 && pnpmRoot.stdout.trim()) {
    const installed = path.join(pnpmRoot.stdout.trim(), "po-shell");
    if (fs.existsSync(installed)) return { method: "pnpm", bin, target: installed };
  }

  return { method: "unknown", bin, target: real };
}

export function updatePlan(method, { packageRoot = PACKAGE_ROOT } = {}) {
  if (method === "npm") return { command: "npm", args: ["install", "-g", "po-shell@latest"] };
  if (method === "pnpm") return { command: "pnpm", args: ["add", "-g", "po-shell@latest"] };
  if (method === "link") return { command: "npm", args: ["link"], cwd: packageRoot };
  return { command: "npm", args: ["install", "-g", "po-shell"] };
}

export function uninstallPlan(method) {
  if (method === "npm") return { command: "npm", args: ["uninstall", "-g", "po-shell"] };
  if (method === "pnpm") return { command: "pnpm", args: ["remove", "-g", "po-shell"] };
  if (method === "link") return { command: "npm", args: ["unlink", "-g", "po-shell"] };
  return null;
}

export function formatCommand(plan) {
  return [plan.command, ...plan.args].join(" ");
}

export function installReport({ cwd = process.cwd(), env = process.env, packageRoot = PACKAGE_ROOT } = {}) {
  const diag = diagnostics({ cwd, env, packageRoot });
  const checks = [...diag.checks];
  const meta = packageMeta(packageRoot);
  const bin = whichBin("po-shell", env);

  checks.push({
    name: "bin en PATH",
    ok: Boolean(bin),
    detail: bin ?? "no está en PATH. En un checkout: npm link",
    warn: true,
  });

  const missingPi = !checks.find((check) => check.name === "Pi")?.ok;
  const nextSteps = [];
  if (missingPi) {
    nextSteps.push("Instalá Pi: npm i -g @earendil-works/pi-coding-agent");
    nextSteps.push("O apuntá a un binario existente: export PO_SHELL_PI_BIN=/ruta/a/pi");
  }
  if (!bin) nextSteps.push("Poné el binario en PATH: npm link (checkout) o npm i -g po-shell");
  nextSteps.push("Verificá todo: po-shell doctor");
  nextSteps.push("Arrancá el agente en tu repo: po-shell");

  const failed = checks.some((check) => !check.ok && !check.warn);
  return {
    ok: !failed,
    version: meta.version,
    name: meta.name,
    packageRoot,
    stateHome: poShellHome(env),
    pi: diag.pi,
    checks,
    nextSteps,
  };
}

export function renderInstallReport(report) {
  for (const check of report.checks) {
    const label = check.ok ? "OK  " : check.warn ? "WARN" : "FAIL";
    console.log(`${label} ${check.name}: ${check.detail}`);
  }
  console.log(`paquete: ${report.name}@${report.version}`);
  console.log(`estado central: ${report.stateHome}`);
  if (report.nextSteps.length) {
    console.log("próximos pasos:");
    for (const step of report.nextSteps) console.log(`  - ${step}`);
  }
  return report.ok ? 0 : 1;
}

/**
 * postinstall: never fails the npm install, never writes, and stays quiet when
 * everything is in place. A broken postinstall cannot uninstall the package.
 */
export function postinstallReport({ env = process.env, packageRoot = PACKAGE_ROOT } = {}) {
  const report = installReport({ cwd: packageRoot, env, packageRoot });
  const problems = report.checks.filter((check) => !check.ok && !check.warn);
  if (!report.ok) {
    console.warn("po-shell: instalado, pero falta algo para arrancar:");
    for (const check of problems) console.warn(`  - ${check.name}: ${check.detail}`);
    for (const step of report.nextSteps) console.warn(`  - ${step}`);
  }
  return report;
}
