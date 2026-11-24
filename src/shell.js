import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { init, isInitialized, poShellPath } from "./kernel.js";
import { readJson } from "./util.js";
import { semanticConfig } from "./semantic.js";
import { cleanupSessionScratch, createSessionScratch, sweepScratch } from "./scratch.js";
import { checkIntegrity, fixIntegrity } from "./backup.js";

const here = path.dirname(fileURLToPath(import.meta.url));

export const PACKAGE_ROOT = path.resolve(here, "..");
export const EXTENSION = path.join(PACKAGE_ROOT, "extensions", "po-shell.ts");
export const SKILL = path.join(PACKAGE_ROOT, "skills", "po-shell-workflow");
export const SKILLS = [
  SKILL,
  path.join(PACKAGE_ROOT, "skills", "agents-md-authoring"),
  path.join(PACKAGE_ROOT, "skills", "skill-md-authoring"),
  path.join(PACKAGE_ROOT, "skills", "feature-doc"),
];
export const PROTOCOL = path.join(PACKAGE_ROOT, "prompts", "po-shell-protocol.md");

const INHERITED_AGENT_ENV = /^(PI_|VIOLETA_)/;

export function cleanPiEnv(env = process.env) {
  if (env.PO_SHELL_KEEP_PI_ENV === "1") return { ...env };
  const clean = { ...env };
  for (const key of Object.keys(clean)) {
    if (INHERITED_AGENT_ENV.test(key)) delete clean[key];
  }
  if (clean.PO_SHELL_PI_AGENT_DIR) clean.PI_CODING_AGENT_DIR = clean.PO_SHELL_PI_AGENT_DIR;
  return clean;
}

export function buildPiArgs(extra = []) {
  const rest = extra[0] === "--" ? extra.slice(1) : extra;
  const args = ["--extension", EXTENSION];
  for (const skill of SKILLS) args.push("--skill", skill);
  args.push("--append-system-prompt", PROTOCOL, ...rest);
  return args;
}

export function resolvePi(env = process.env) {
  if (env.PO_SHELL_PI_BIN) {
    return { command: env.PO_SHELL_PI_BIN, prefix: [], source: "PO_SHELL_PI_BIN" };
  }

  const which = spawnSync(process.platform === "win32" ? "where" : "which", ["pi"], {
    encoding: "utf8",
  });
  if (which.status === 0) {
    const found = which.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    if (found) return { command: found, prefix: [], source: "PATH" };
  }

  try {
    const require = createRequire(import.meta.url);
    const pkgPath = require.resolve("@earendil-works/pi-coding-agent/package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    const rel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.pi;
    if (rel) {
      return {
        command: process.execPath,
        prefix: [path.resolve(path.dirname(pkgPath), rel)],
        source: "node_modules",
      };
    }
  } catch {
    // Sin Pi como dependencia; se usa PATH o PO_SHELL_PI_BIN.
  }

  return null;
}

export function agentDir(env = process.env) {
  return env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent");
}

export function providerDiagnostics(env = process.env) {
  const dir = agentDir(env);
  const modelsPath = path.join(dir, "models.json");
  const settingsPath = path.join(dir, "settings.json");
  const models = readJson(modelsPath, null);
  const settings = readJson(settingsPath, {});
  return {
    agentDir: dir,
    modelsPath,
    modelsFile: fs.existsSync(modelsPath),
    modelsValid: models !== null,
    providers: models?.providers ? Object.keys(models.providers) : [],
    defaultProvider: settings.defaultProvider ?? null,
    defaultModel: settings.defaultModel ?? null,
    authFile: fs.existsSync(path.join(dir, "auth.json")),
  };
}

export function diagnostics({ cwd = process.cwd(), env = process.env, packageRoot = PACKAGE_ROOT } = {}) {
  const effectiveEnv = cleanPiEnv(env);
  const checks = [];
  const add = (name, ok, detail, warn = false) => checks.push({ name, ok, detail, warn });
  const extension = path.join(packageRoot, "extensions", "po-shell.ts");
  const protocol = path.join(packageRoot, "prompts", "po-shell-protocol.md");
  const skills = SKILLS;

  const nodeMajor = Number(process.versions.node.split(".")[0]);
  add("Node 22+", nodeMajor >= 22, process.version);

  const git = spawnSync("git", ["--version"], { encoding: "utf8" });
  add("git", git.status === 0, (git.stdout || git.stderr || "").trim() || "no encontrado");

  const pi = resolvePi(effectiveEnv);
  const piExists =
    pi &&
    (pi.source !== "PO_SHELL_PI_BIN" ||
      fs.existsSync(pi.command) ||
      spawnSync(process.platform === "win32" ? "where" : "which", [pi.command]).status === 0);
  add(
    "Pi",
    Boolean(piExists),
    pi
      ? `${pi.source}: ${[pi.command, ...pi.prefix].join(" ")}`
      : "no encontrado. Instalá Pi o definí PO_SHELL_PI_BIN",
  );

  add("extensión", fs.existsSync(extension), extension);
  const missingSkills = skills.filter((skill) => !fs.existsSync(skill));
  add(
    "skills",
    missingSkills.length === 0,
    missingSkills.length ? `faltan: ${missingSkills.join(", ")}` : skills.join(", "),
  );
  add("protocolo", fs.existsSync(protocol), protocol);
  const semantic = semanticConfig(effectiveEnv);
  add(
    "semantic",
    Boolean(semantic),
    semantic ? `${semantic.embeddingModel} + ${semantic.rerankModel}` : "off o sin credenciales Nan",
    true,
  );

  const providers = providerDiagnostics(effectiveEnv);
  add("agent dir", true, providers.agentDir);
  add(
    "models.json",
    providers.modelsFile && providers.modelsValid,
    providers.modelsFile
      ? providers.modelsValid
        ? providers.modelsPath
        : "JSON inválido"
      : "no existe (usá /login o models.json)",
    true,
  );
  add(
    "providers",
    providers.providers.length > 0,
    providers.providers.length ? providers.providers.join(", ") : "ninguno declarado",
    true,
  );
  add(
    "default model",
    Boolean(providers.defaultProvider && providers.defaultModel),
    providers.defaultProvider && providers.defaultModel
      ? `${providers.defaultProvider}/${providers.defaultModel}`
      : "sin defaultProvider/defaultModel",
    true,
  );
  add("auth.json", providers.authFile, providers.authFile ? "presente" : "no existe", true);

  const inGit = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd,
    encoding: "utf8",
  });
  const isGitRepo = inGit.status === 0 && inGit.stdout.trim() === "true";
  add("repo git", isGitRepo, isGitRepo ? cwd : "el cwd no es un repo git", true);

  const initialized = isInitialized(cwd, env);
  add(
    "estado central",
    initialized,
    initialized ? poShellPath(cwd, env) : "se inicializa al arrancar",
    true,
  );

  const failed = checks.some((check) => !check.ok && !check.warn);
  return { ok: !failed, failed, checks, pi: piExists ? pi : null, context: { cwd, packageRoot } };
}

export function renderDiagnostics(report) {
  for (const check of report.checks) {
    const label = check.ok ? "OK  " : check.warn ? "WARN" : "FAIL";
    console.log(`${label} ${check.name}: ${check.detail}`);
  }
  return report.ok ? 0 : 1;
}

export function doctor({ cwd = process.cwd(), env = process.env } = {}) {
  return renderDiagnostics(diagnostics({ cwd, env }));
}

function formatIntegrity(report) {
  return report.checks
    .filter((check) => !check.ok)
    .map((check) => `  ${check.level === "error" ? "ERROR" : "WARN "} ${check.name}: ${check.detail}`)
    .join("\n");
}

export function ensureProject(cwd = process.cwd(), env = process.env) {
  const wasInitialized = isInitialized(cwd, env);
  if (!wasInitialized) {
    try {
      const result = init(cwd, env);
      console.error(`po-shell inicializado en ${result.root}`);
      if (result.migratedFrom) {
        console.error(`  estado anterior migrado desde ${result.migratedFrom}`);
      }
    } catch (error) {
      return {
        ok: false,
        initialized: false,
        report: {
          ok: false,
          errors: 1,
          warnings: 0,
          checks: [{ name: "init", level: "error", ok: false, detail: error.message }],
        },
      };
    }
  }

  let report;
  try {
    report = checkIntegrity(cwd, { env });
  } catch (error) {
    return {
      ok: false,
      initialized: !wasInitialized,
      report: {
        ok: false,
        errors: 1,
        warnings: 0,
        checks: [{ name: "integrity", level: "error", ok: false, detail: error.message }],
      },
    };
  }

  if (report.errors === 0 && report.warnings > 0) {
    try {
      const fixed = fixIntegrity(cwd, { env });
      report = fixed.integrity;
    } catch {
      // Las advertencias que no se pueden reparar quedan visibles.
    }
  }

  return { ok: report.errors === 0, initialized: !wasInitialized, report };
}

export async function launch({ cwd = process.cwd(), env = process.env, args = [] } = {}) {
  const pi = resolvePi(env);
  if (!pi) {
    console.error("po-shell: no encontré Pi.");
    console.error("  Instalá Pi o definí PO_SHELL_PI_BIN=/ruta/al/binario/pi");
    console.error("  Después probá: po-shell doctor");
    return 1;
  }

  const piArgs = buildPiArgs(args);
  if (env.PO_SHELL_DRY_RUN === "1") {
    console.log(JSON.stringify({ command: pi.command, args: [...pi.prefix, ...piArgs] }, null, 2));
    return 0;
  }

  const project = ensureProject(cwd, env);
  if (!project.ok) {
    console.error("po-shell: el estado del proyecto no está sano; no abro el chat.");
    const detail = formatIntegrity(project.report);
    if (detail) console.error(detail);
    console.error("  Corregí con: po-shell integrity --fix, o restaurá un backup con po-shell restore.");
    return 1;
  }
  if (project.report.warnings > 0) {
    const detail = formatIntegrity(project.report);
    if (detail) console.error(detail);
  }

  let scratch = null;
  try {
    sweepScratch(env);
    scratch = createSessionScratch(env, { cwd });
  } catch (error) {
    console.error(`po-shell: no se pudo crear el scratch de sesión: ${error.message}`);
  }

  return await new Promise((resolve) => {
    let settled = false;
    let child;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      if (scratch) cleanupSessionScratch(scratch);
      resolve(code);
    };

    try {
      child = spawn(pi.command, [...pi.prefix, ...piArgs], {
        cwd,
        stdio: "inherit",
        env: {
          ...cleanPiEnv(env),
          ...(scratch?.env ?? {}),
          PO_SHELL_SHELL: "1",
        },
        shell: process.platform === "win32",
      });
    } catch (error) {
      console.error(`po-shell: no se pudo iniciar Pi: ${error.message}`);
      return finish(1);
    }

    child.on("error", (error) => {
      console.error(`po-shell: no se pudo iniciar Pi: ${error.message}`);
      finish(1);
    });
    child.on("exit", (code, signal) => {
      finish(code ?? (signal ? 1 : 0));
    });
  });
}
