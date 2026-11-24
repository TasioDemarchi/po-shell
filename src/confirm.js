// Human-facing dialogues: destructive confirmation and high-risk plan approval.
//
// The policy decides; these ask. Both are UI-agnostic on purpose so the
// fail-closed path and the exact text can be tested: without a usable UI the
// answer is always "no", and every dialogue carries its own title.

export const CONFIRM_ALLOW = "Permitir esta vez";
export const CONFIRM_DENY = "Denegar";
export const PLAN_APPROVE = "Aprobar";
export const PLAN_REJECT = "Rechazar";

/** Human label per guard key (src/destructive.js). Never show the raw key. */
export const GUARD_TITLES = {
  rmRecursive: "borrado recursivo",
  findDelete: "borrado masivo con find",
  gitResetHard: "git reset --hard (descarta cambios)",
  gitCleanForce: "git clean forzado",
  gitCheckoutOverwrite: "git checkout/restore que pisa archivos",
  gitBranchDelete: "borrado de rama",
  gitRebase: "git rebase",
  gitStashDrop: "git stash drop/clear",
  gitPushForce: "git push forzado",
  destructiveSql: "SQL que borra datos",
  diskWrite: "escritura directa a un dispositivo",
};

const FALLBACK_TITLE = "comando destructivo";

export function previewCommand(input, limit = 240) {
  const command = String(input?.command ?? "").replace(/\s+/g, " ").trim();
  return command.length > limit ? `${command.slice(0, limit)}…` : command;
}

export function guardLabel(key) {
  return GUARD_TITLES[key] ?? FALLBACK_TITLE;
}

/**
 * Title of the destructive confirmation: what is about to happen, in words a
 * human reads, with the exact command and its targets as context.
 */
export function destructiveTitle(verdict, input) {
  const label = guardLabel(verdict?.key);
  const targets = (verdict?.targets ?? []).filter(Boolean).join(" ");
  const detail = targets ? ` · ${targets}` : "";
  return `Permitir comando destructivo · ${label}${detail}\n${previewCommand(input)}`;
}

const SUMMARY_LIMIT = 220;

function firstLine(text) {
  const line = String(text ?? "")
    .split("\n")
    .map((value) => value.replace(/^\s*(?:[-*+]|\d+[.)])\s*/, "").trim())
    .find(Boolean) ?? "";
  return line.length > SUMMARY_LIMIT ? `${line.slice(0, SUMMARY_LIMIT)}…` : line;
}

/**
 * Title of the plan approval. The detailed plan belongs in the agent's reply;
 * the dialog gets a title and one short line, so the human approves a decision
 * instead of re-reading the plan.
 */
export function planApprovalTitle(task) {
  const summary = String(task?.planSummary ?? "").trim() || firstLine(task?.plan);
  const title = `Aprobar plan · ${task?.title ?? "tarea"}`;
  return summary ? `${title}\n${summary}` : title;
}

/**
 * Returns true only when a human explicitly allowed this call.
 * No UI, a broken UI or an unknown answer all mean "no".
 */
export async function confirmDestructive(ctx, verdict, input) {
  if (ctx?.hasUI !== true || typeof ctx?.ui?.select !== "function") return false;
  try {
    const choice = await ctx.ui.select(destructiveTitle(verdict, input), [CONFIRM_ALLOW, CONFIRM_DENY]);
    return choice === CONFIRM_ALLOW;
  } catch {
    return false;
  }
}
