import path from "node:path";
import { readJson, writeJson } from "./util.js";
import { projectStateDir } from "./project.js";

// What the orchestrator runs to *find* something. edit, write, po_shell_* and
// web_* are not discovery, so they never add up.
const DISCOVERY_TOOLS = new Set(["read", "grep", "find", "ls", "bash"]);
const NUDGE_FROM = 3;
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
 * Count one discovery call. A different task or a new `implementingAt` starts
 * over at 1, so nobody has to clear the file by hand.
 *
 * Returns the stored state, or null when the call is not discovery or there is
 * no task to attribute it to.
 */
export function bumpDiscovery(cwd, toolName, task, env = process.env) {
  const key = keyOf(task);
  if (!key || !DISCOVERY_TOOLS.has(String(toolName ?? ""))) return null;
  try {
    const stored = readJson(discoveryPath(cwd, env), null);
    const same =
      Boolean(stored) &&
      stored.taskId === key.taskId &&
      (stored.implementingAt ?? null) === key.implementingAt;
    const next = { ...key, count: same ? (Number(stored.count) || 0) + 1 : 1 };
    writeJson(discoveryPath(cwd, env), next);
    return next;
  } catch {
    // A counter that cannot be written must not break the tool call it counts.
    return null;
  }
}

/**
 * The nudge as the callers need it: the count always, the sentence only from the
 * third call and only while the task is being worked on. Text, never a gate.
 */
export function discoveryNote(cwd, task, env = process.env) {
  const key = keyOf(task);
  let count = 0;
  if (key) {
    try {
      const stored = readJson(discoveryPath(cwd, env), null);
      const same =
        Boolean(stored) &&
        stored.taskId === key.taskId &&
        (stored.implementingAt ?? null) === key.implementingAt;
      if (same) count = Math.max(0, Math.trunc(Number(stored.count) || 0));
    } catch {
      count = 0;
    }
  }
  const applies = Boolean(key) && NUDGE_PHASES.has(String(task?.phase ?? ""));
  const text =
    applies && count >= NUDGE_FROM
      ? `${count} llamadas sin delegar — el skill pide un explorer`
      : null;
  return { count, text };
}
