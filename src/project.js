import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { expandHome, readJson, sha256 } from "./util.js";

const identityCache = new Map();

export function poShellHome(env = process.env) {
  return env.PO_SHELL_HOME ? expandHome(env.PO_SHELL_HOME) : path.join(os.homedir(), ".po-shell");
}

function projectRoot(cwd) {
  const start = path.resolve(cwd);
  const git = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: start,
    encoding: "utf8",
  });
  if (git.status === 0 && git.stdout.trim()) return git.stdout.trim();
  let current = start;
  for (;;) {
    if (fs.existsSync(path.join(current, "PROJECT.md")) || fs.existsSync(path.join(current, "AGENTS.md"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return start;
    current = parent;
  }
}

export function projectIdentity(cwd = process.cwd(), env = process.env) {
  const root = projectRoot(cwd);
  const cacheKey = `${poShellHome(env)}::${root}`;
  if (identityCache.has(cacheKey)) return identityCache.get(cacheKey);

  const remote = spawnSync("git", ["remote", "get-url", "origin"], {
    cwd: root,
    encoding: "utf8",
  });
  const key = remote.status === 0 && remote.stdout.trim() ? remote.stdout.trim() : root;
  const computed = sha256(key).slice(0, 16);
  const identity = {
    // Adding a git remote changes the computed id. If the root already has state
    // under another id, adopt it instead of starting from an empty directory.
    id: adoptStateId(root, computed, env),
    name: path.basename(root) || "root",
    root,
  };
  identityCache.set(cacheKey, identity);
  return identity;
}

function adoptStateId(root, computed, env) {
  const projectsDir = path.join(poShellHome(env), "projects");
  if (fs.existsSync(path.join(projectsDir, computed))) return computed;
  let entries;
  try {
    entries = fs.readdirSync(projectsDir, { withFileTypes: true });
  } catch {
    return computed;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const meta = readJson(path.join(projectsDir, entry.name, "project.json"), null);
    if (meta?.root === root) return entry.name;
  }
  return computed;
}

export function projectStateDir(cwd = process.cwd(), env = process.env) {
  return path.join(poShellHome(env), "projects", projectIdentity(cwd, env).id);
}

export function legacyStateDir(cwd = process.cwd()) {
  return path.join(path.resolve(cwd), ".po-shell");
}


export function projectMetaPath(cwd = process.cwd(), env = process.env) {
  return path.join(projectStateDir(cwd, env), "project.json");
}

export function projectInfo(cwd = process.cwd(), env = process.env) {
  const identity = projectIdentity(cwd, env);
  const stateDir = projectStateDir(cwd, env);
  const meta = readJson(projectMetaPath(cwd, env), null);
  return {
    id: identity.id,
    name: meta?.name ?? identity.name,
    root: meta?.root ?? identity.root,
    stateDir,
    contextDb: env.PO_SHELL_CONTEXT_DB
      ? expandHome(env.PO_SHELL_CONTEXT_DB)
      : path.join(poShellHome(env), "context.db"),
    initialized: fs.existsSync(path.join(stateDir, "config.json")),
    updatedAt: meta?.updatedAt ?? null,
  };
}

export function listProjectStates(env = process.env, options = {}) {
  const root = path.join(poShellHome(env), "projects");
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const stateDir = path.join(root, entry.name);
      const meta = readJson(path.join(stateDir, "project.json"), null);
      let updatedAt = meta?.updatedAt ?? null;
      if (!updatedAt) {
        try {
          updatedAt = fs.statSync(path.join(stateDir, "config.json")).mtime.toISOString();
        } catch {
          // Sin config todavía.
        }
      }
      const initialized = fs.existsSync(path.join(stateDir, "config.json"));
      return {
        id: entry.name,
        name: meta?.name ?? entry.name,
        root: meta?.root ?? null,
        stateDir,
        initialized,
        updatedAt,
        hasMetadata: Boolean(meta?.root),
      };
    })
    .filter((item) => options.all || item.hasMetadata)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function resolveProjectState(selector, env = process.env) {
  const wanted = String(selector ?? "").trim();
  if (!wanted) return null;
  const abs = path.resolve(wanted);
  return (
    listProjectStates(env, { all: true }).find(
      (item) =>
        item.id === wanted ||
        item.name === wanted ||
        item.root === wanted ||
        item.root === abs,
    ) ?? null
  );
}

export function pruneProjectStates(env = process.env, options = {}) {
  const dryRun = options.dryRun !== false;
  const candidates = listProjectStates(env, { all: true }).filter(
    (item) => !item.hasMetadata || !item.root || !fs.existsSync(item.root),
  );
  if (dryRun || !candidates.length) {
    return { dryRun, trashDir: null, candidates, moved: [] };
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const trashDir = path.join(poShellHome(env), "trash", stamp);
  const moved = [];
  for (const item of candidates) {
    try {
      fs.mkdirSync(trashDir, { recursive: true });
      const target = path.join(trashDir, item.id);
      try {
        fs.renameSync(item.stateDir, target);
      } catch {
        fs.cpSync(item.stateDir, target, { recursive: true });
        fs.rmSync(item.stateDir, { recursive: true, force: true });
      }
      moved.push(item);
    } catch {
      // Un directorio que no se puede mover se deja intacto.
    }
  }
  return { dryRun, trashDir, candidates, moved };
}
