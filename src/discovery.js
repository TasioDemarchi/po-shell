import path from "node:path";
import { readJson, writeJson } from "./util.js";
import { projectStateDir } from "./project.js";

// What the orchestrator runs to *find* something. edit, write, po_shell_* and
// web_* are not discovery, so they never add up.
const DISCOVERY_TOOLS = new Set(["read", "grep", "find", "ls", "bash"]);
const NUDGE_FROM = 3;
// One 50 KB read is as much discovery as twenty greps: count alone would miss it.
const NUDGE_BYTES = 40960;
const NUDGE_PHASES = new Set(["implementing", "checking"]);

// The counter lives in the central state, never in the repo: it is bookkeeping,
// not a project artifact, and a stray write in the tree would show up in reviews.
function discoveryPath(cwd = process.cwd(), env = process.env) {
  return path.join(projectStateDir(cwd, env), "discovery.json");
}

/** The reset key: a new task, or the same task moving to implementing again. */
function keyOf(task) {
  const taskId = String(task?.id ?? "").trim();
  if (!taskId) return null;
  return { taskId, implementingAt: task?.implementingAt ?? null };
}

/**
 * The state for this key, zeroed when the key is new: both counters reset
 * together so a new round never inherits the previous one's evidence.
 */
function stateOf(cwd, key, env) {
  const empty = { count: 0, bytes: 0 };
  if (!key) return empty;
  try {
    const stored = readJson(discoveryPath(cwd, env), null);
    const same =
      Boolean(stored) &&
      stored.taskId === key.taskId &&
      (stored.implementingAt ?? null) === key.implementingAt;
    if (!same) return empty;
    return {
      count: Math.max(0, Math.trunc(Number(stored.count) || 0)),
      bytes: Math.max(0, Math.trunc(Number(stored.bytes) || 0)),
    };
  } catch {
    return empty;
  }
}

function isDiscovery(toolName) {
  return DISCOVERY_TOOLS.has(String(toolName ?? ""));
}

/**
 * Count one discovery call. A different task or a new `implementingAt` starts
 * over at 1, so nobody has to clear the file by hand.
 *
 * Returns the stored state, or null when the call is not discovery or there is
 * no task to attribute it to.
 */
export function bumpDiscovery(cwd, toolName, task, env = process.env) {
  const key = keyOf(task);
  if (!key || !isDiscovery(toolName)) return null;
  try {
    const current = stateOf(cwd, key, env);
    const next = { ...key, count: current.count + 1, bytes: current.bytes };
    writeJson(discoveryPath(cwd, env), next);
    return next;
  } catch {
    // A counter that cannot be written must not break the tool call it counts.
    return null;
  }
}

/**
 * Add the size of one discovery result, same reset key as the call count. Zero
 * or garbage sizes are ignored, so a caller never has to sanitise the length.
 *
 * Returns the stored state, or null when nothing was added.
 */
export function addDiscoveryBytes(cwd, toolName, task, bytes, env = process.env) {
  const key = keyOf(task);
  if (!key || !isDiscovery(toolName)) return null;
  const added = Math.max(0, Math.trunc(Number(bytes) || 0));
  if (!added) return null;
  try {
    const current = stateOf(cwd, key, env);
    const next = { ...key, count: current.count, bytes: current.bytes + added };
    writeJson(discoveryPath(cwd, env), next);
    return next;
  } catch {
    // Same as the counter: bookkeeping never breaks a tool.
    return null;
  }
}

/** Whole KB for big reads, one decimal for the first few, so the line stays short. */
export function discoveryKb(bytes) {
  const kb = Math.max(0, Math.trunc(Number(bytes) || 0)) / 1024;
  return String(kb >= 10 ? Math.round(kb) : Math.round(kb * 10) / 10);
}

/**
 * The nudge as the callers need it: both numbers always, the sentence when the
 * calls or the bytes cross their line, and only while the task is being worked
 * on. Text, never a gate.
 */
export function discoveryNote(cwd, task, env = process.env) {
  const key = keyOf(task);
  const state = stateOf(cwd, key, env);
  const applies = Boolean(key) && NUDGE_PHASES.has(String(task?.phase ?? ""));
  const fired = state.count >= NUDGE_FROM || state.bytes >= NUDGE_BYTES;
  const text =
    applies && fired
      ? `${state.count} llamadas y ${discoveryKb(state.bytes)} KB leídos sin delegar — el skill pide un explorer`
      : null;
  return { count: state.count, bytes: state.bytes, text };
}
