import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { init, isInitialized, plainPath } from "./kernel.js";
import { readJson } from "./util.js";
import { semanticConfig } from "./semantic.js";

const here = path.dirname(fileURLToPath(import.meta.url));

export const PACKAGE_ROOT = path.resolve(here, "..");
export const EXTENSION = path.join(PACKAGE_ROOT, "extensions", "plain.ts");
export const SKILL = path.join(PACKAGE_ROOT, "skills", "plain-workflow");
export const SKILLS = [
  SKILL,
  path.join(PACKAGE_ROOT, "skills", "agents-md-authoring"),
  path.join(PACKAGE_ROOT, "skills", "skill-md-authoring"),
  path.join(PACKAGE_ROOT, "skills", "feature-doc"),
];
export const PROTOCOL = path.join(PACKAGE_ROOT, "prompts", "plain-protocol.md");

const INHERITED_AGENT_ENV = /^(PI_|VIOLETA_)/;

export function cleanPiEnv(env = process.env) {
  if (env.PLAIN_KEEP_PI_ENV === "1") return { ...env };
  const clean = { ...env };
  for (const key of Object.keys(clean)) {
    if (INHERITED_AGENT_ENV.test(key)) delete clean[key];
  }
  if (clean.PLAIN_PI_AGENT_DIR) clean.PI_CODING_AGENT_DIR = clean.PLAIN_PI_AGENT_DIR;
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
  if (env.PLAIN_PI_BIN) {
    return { command: env.PLAIN_PI_BIN, prefix: [], source: "PLAIN_PI_BIN" };
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
    // Sin Pi como dependencia; se usa PATH o PLAIN_PI_BIN.
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

export function doctor({ cwd = process.cwd(), env = process.env } = {}) {
  const effectiveEnv = cleanPiEnv(env);
  const checks = [];
  const add = (name, ok, detail, warn = false) => checks.push({ name, ok, detail, warn });

  const nodeMajor = Number(process.versions.node.split(".")[0]);
  add("Node 22+", nodeMajor >= 22, process.version);

  const git = spawnSync("git", ["--version"], { encoding: "utf8" });
  add("git", git.status === 0, (git.stdout || git.stderr || "").trim() || "no encontrado");

  const pi = resolvePi(effectiveEnv);
  const piExists =
    pi &&
    (pi.source !== "PLAIN_PI_BIN" ||
      fs.existsSync(pi.command) ||
      spawnSync(process.platform === "win32" ? "where" : "which", [pi.command]).status === 0);
  add(
    "Pi",
    Boolean(piExists),
    pi
      ? `${pi.source}: ${[pi.command, ...pi.prefix].join(" ")}`
      : "no encontrado. Instalá Pi o definí PLAIN_PI_BIN",
  );

  add("extensión", fs.existsSync(EXTENSION), EXTENSION);
  const missingSkills = SKILLS.filter((skill) => !fs.existsSync(skill));
  add(
    "skills",
    missingSkills.length === 0,
    missingSkills.length ? `faltan: ${missingSkills.join(", ")}` : SKILLS.join(", "),
  );
  add("protocolo", fs.existsSync(PROTOCOL), PROTOCOL);
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
    initialized ? plainPath(cwd, env) : "se inicializa al arrancar",
    true,
  );

  for (const check of checks) {
    const label = check.ok ? "OK  " : check.warn ? "WARN" : "FAIL";
    console.log(`${label} ${check.name}: ${check.detail}`);
  }

  const failed = checks.some((check) => !check.ok && !check.warn);
  return failed ? 1 : 0;
}

export async function launch({ cwd = process.cwd(), env = process.env, args = [] } = {}) {
  const pi = resolvePi(env);
  if (!pi) {
    console.error("plain: no encontré Pi.");
    console.error("  Instalá Pi o definí PLAIN_PI_BIN=/ruta/al/binario/pi");
    console.error("  Después probá: plain doctor");
    return 1;
  }

  const piArgs = buildPiArgs(args);
  if (env.PLAIN_DRY_RUN === "1") {
    console.log(JSON.stringify({ command: pi.command, args: [...pi.prefix, ...piArgs] }, null, 2));
    return 0;
  }

  if (!isInitialized(cwd, env)) {
    try {
      const result = init(cwd, env);
      console.error(`Plain inicializado en ${result.root}`);
      if (result.migratedFrom) {
        console.error(`  estado anterior migrado desde ${result.migratedFrom}`);
      }
    } catch (error) {
      console.error(`plain: no se pudo inicializar el estado central: ${error.message}`);
    }
  }

  return await new Promise((resolve) => {
    const child = spawn(pi.command, [...pi.prefix, ...piArgs], {
      cwd,
      stdio: "inherit",
      env: { ...cleanPiEnv(env), PLAIN_SHELL: "1" },
      shell: process.platform === "win32",
    });

    child.on("error", (error) => {
      console.error(`plain: no se pudo iniciar Pi: ${error.message}`);
      resolve(1);
    });
    child.on("exit", (code, signal) => {
      resolve(code ?? (signal ? 1 : 0));
    });
  });
}
