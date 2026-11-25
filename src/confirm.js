// Human-facing dialogues: destructive confirmation and high-risk plan approval.
//
// The policy decides; these ask. Both are UI-agnostic on purpose so the
// fail-closed path and the exact text can be tested: without a usable UI the
// answer is always "no", and every dialogue carries its own title.

export const CONFIRM_ALLOW = "Allow once";
export const CONFIRM_DENY = "Deny";
export const PLAN_APPROVE = "Approve";
export const PLAN_REJECT = "Reject";

/** Human label per guard key (src/destructive.js). Never show the raw key. */
export const GUARD_TITLES = {
  rmRecursive: "recursive delete",
  findDelete: "bulk delete with find",
  gitResetHard: "hard reset (discards changes)",
  gitCleanForce: "forced clean",
  gitCheckoutOverwrite: "checkout/restore that overwrites files",
  gitBranchDelete: "branch delete",
  gitRebase: "rebase",
  gitStashDrop: "stash drop/clear",
  gitPushForce: "forced push",
  destructiveSql: "SQL that deletes data",
  diskWrite: "write to a device",
};

const FALLBACK_TITLE = "destructive command";

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
  return `Allow destructive command · ${label}${detail}\n${previewCommand(input)}`;
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
  const title = `Approve plan · ${task?.title ?? "task"}`;
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
