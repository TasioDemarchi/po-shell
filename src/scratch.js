import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { poShellHome } from "./project.js";
import { ensureDir, expandHome, readJson, nowIso } from "./util.js";

export const SCRATCH_VERSION = 1;
export const SESSION_PREFIX = "po-shell-";
export const SUBAGENT_PREFIX = "po-shell-sub-";
const SESSION_NAME = /^po-shell-[A-Za-z0-9]{6}$/;
const SUBAGENT_NAME = /^po-shell-sub-[A-Za-z0-9]{6}$/;
const SWEEP_GRACE_MS = 60 * 60 * 1000;

export function scratchRoot(env = process.env) {
  return env.PO_SHELL_TMP_ROOT
    ? path.resolve(expandHome(env.PO_SHELL_TMP_ROOT))
    : path.join(poShellHome(env), "tmp");
}

function ledgerRoot(root) {
  return path.join(root, "ledger");
}

function safeId(id) {
  return String(id ?? "")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "session";
}

function ledgerPath(root, id) {
  return path.join(ledgerRoot(root), `${safeId(id)}.json`);
}

function writeJsonPrivate(file, value) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    fs.renameSync(tmp, file);
  } catch (error) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // Ya se renombró o nunca existió.
    }
    throw error;
  }
}

function realOrUndefined(value) {
  try {
    return fs.realpathSync(value);
  } catch {
    return undefined;
  }
}

function scratchEnv(dir, platform = process.platform) {
  return {
    TMPDIR: dir,
    ...(platform === "win32" ? { TMP: dir, TEMP: dir } : {}),
  };
}

function validScratchDir(dir, expectedRoot, namePattern) {
  if (!dir || !path.isAbsolute(dir) || !expectedRoot || !path.isAbsolute(expectedRoot)) return false;
  if (path.dirname(dir) !== expectedRoot) return false;
  if (!namePattern.test(path.basename(dir))) return false;
  let stat;
  try {
    stat = fs.lstatSync(dir);
  } catch {
    return false;
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) return false;
  const uid = process.getuid?.();
  if (uid !== undefined && stat.uid !== uid) return false;
  return realOrUndefined(dir) === dir;
}

export function scratchEnvironment(dir, platform = process.platform) {
  return scratchEnv(dir, platform);
}

export function createSessionScratch(env = process.env, options = {}) {
  const root = scratchRoot(env);
  ensureDir(root);
  try {
    fs.chmodSync(root, 0o700);
  } catch {
    // Windows no aplica permisos POSIX.
  }
  const tempRoot = realOrUndefined(root) ?? root;
  const raw = fs.mkdtempSync(path.join(tempRoot, SESSION_PREFIX));
  let dir;
  try {
    fs.chmodSync(raw, 0o700);
    dir = realOrUndefined(raw) ?? raw;
  } catch (error) {
    try {
      fs.rmSync(raw, { recursive: true, force: true });
    } catch {
      // best effort
    }
    throw error;
  }
  const id = randomUUID();
  const ledger = {
    version: SCRATCH_VERSION,
    id,
    pid: process.pid,
    startedAt: nowIso(),
    cwd: options.cwd ?? process.cwd(),
    tempRoot,
    inherited: {
      TMPDIR: env.TMPDIR ?? null,
      TMP: env.TMP ?? null,
      TEMP: env.TEMP ?? null,
    },
    scratchDir: dir,
  };
  const pathToLedger = ledgerPath(tempRoot, id);
  try {
    writeJsonPrivate(pathToLedger, ledger);
  } catch (error) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // best effort
    }
    throw error;
  }
  return {
    id,
    dir,
    scratchDir: dir,
    tempRoot,
    ledgerPath: pathToLedger,
    ledger,
    env: {
      ...scratchEnv(dir),
      PO_SHELL_TMP: dir,
      PO_SHELL_SCRATCH_ID: id,
    },
  };
}

export function createSubagentScratch(env = process.env) {
  const parent = env.PO_SHELL_TMP && path.isAbsolute(env.PO_SHELL_TMP) && fs.existsSync(env.PO_SHELL_TMP)
    ? realOrUndefined(env.PO_SHELL_TMP) ?? env.PO_SHELL_TMP
    : scratchRoot(env);
  ensureDir(parent);
  try {
    fs.chmodSync(parent, 0o700);
  } catch {
    // best effort
  }
  const raw = fs.mkdtempSync(path.join(parent, SUBAGENT_PREFIX));
  try {
    fs.chmodSync(raw, 0o700);
  } catch {
    // best effort
  }
  const dir = realOrUndefined(raw) ?? raw;
  return {
    dir,
    env: scratchEnv(dir),
    cleanup() {
      if (!validScratchDir(dir, parent, SUBAGENT_NAME)) return false;
      try {
        fs.rmSync(dir, { recursive: true, force: true });
        return true;
      } catch {
        return false;
      }
    },
  };
}

export function cleanupSessionScratch(record) {
  if (!record?.scratchDir) return false;
  const tempRoot = record.tempRoot;
  if (!validScratchDir(record.scratchDir, tempRoot, SESSION_NAME)) return false;
  try {
    fs.rmSync(record.scratchDir, { recursive: true, force: true });
  } catch {
    return false;
  }
  try {
    fs.unlinkSync(record.ledgerPath);
  } catch {
    // El ledger puede haber desaparecido.
  }
  return true;
}

export function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

export function listScratch(env = process.env) {
  const root = scratchRoot(env);
  const dir = ledgerRoot(root);
  let names;
  try {
    names = fs.readdirSync(dir).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
  const records = [];
  for (const name of names) {
    const pathToLedger = path.join(dir, name);
    const ledger = readJson(pathToLedger, null);
    if (!ledger || ledger.version !== SCRATCH_VERSION || !ledger.scratchDir) {
      if (ledger) records.push({ ledgerPath: pathToLedger, ledger, live: false, valid: false });
      continue;
    }
    const valid = validScratchDir(ledger.scratchDir, ledger.tempRoot, SESSION_NAME);
    records.push({
      ledgerPath: pathToLedger,
      ledger,
      valid,
      live: isProcessAlive(ledger.pid),
    });
  }
  return records.sort((a, b) => String(b.ledger.startedAt).localeCompare(String(a.ledger.startedAt)));
}

export function sweepScratch(env = process.env, options = {}) {
  const graceMs = Number.isFinite(options.graceMs) ? Math.max(0, options.graceMs) : SWEEP_GRACE_MS;
  const now = Date.now();
  const removed = [];
  const kept = [];
  const refused = [];
  for (const item of listScratch(env)) {
    const { ledger } = item;
    const age = now - new Date(ledger.startedAt).getTime();
    if (item.live) {
      kept.push({ ...item, reason: "live process" });
      continue;
    }
    if (age < graceMs) {
      kept.push({ ...item, reason: "within grace period" });
      continue;
    }
    if (!item.valid) {
      refused.push({ ...item, reason: "invalid scratch" });
      continue;
    }
    if (cleanupSessionScratch({
      scratchDir: ledger.scratchDir,
      tempRoot: ledger.tempRoot,
      ledgerPath: item.ledgerPath,
    })) {
      removed.push(item);
    } else {
      refused.push({ ...item, reason: "removal refused" });
    }
  }
  return { removed, kept, refused, root: scratchRoot(env) };
}

export function directorySize(dir) {
  let total = 0;
  const stack = [dir];
  for (let visited = 0; stack.length > 0 && visited < 100_000; visited += 1) {
    const current = stack.pop();
    try {
      const stat = fs.lstatSync(current);
      if (stat.isDirectory()) {
        for (const name of fs.readdirSync(current)) stack.push(path.join(current, name));
      } else if (stat.isFile()) {
        total += stat.size;
      }
    } catch {
      // Removido mientras se recorre.
    }
  }
  return total;
}

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}
