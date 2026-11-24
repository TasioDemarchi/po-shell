// Human confirmation for destructive-but-covered commands.
//
// The policy decides; this asks. It is UI-agnostic on purpose so the fail-closed
// path can be tested: without a usable UI the answer is always "no".

export const CONFIRM_ALLOW = "Permitir esta vez";
export const CONFIRM_DENY = "Denegar";

export function previewCommand(input, limit = 240) {
  const command = String(input?.command ?? "").replace(/\s+/g, " ").trim();
  return command.length > limit ? `${command.slice(0, limit)}…` : command;
}

export function confirmTitle(verdict, input) {
  const targets = (verdict?.targets ?? []).join(" ");
  const detail = targets ? ` (${targets})` : "";
  return `po-shell: ${verdict?.key ?? "comando"}${detail} · ${previewCommand(input)}`;
}

/**
 * Returns true only when a human explicitly allowed this call.
 * No UI, a broken UI or an unknown answer all mean "no".
 */
export async function confirmDestructive(ctx, verdict, input) {
  if (ctx?.hasUI !== true || typeof ctx?.ui?.select !== "function") return false;
  try {
    const choice = await ctx.ui.select(confirmTitle(verdict, input), [CONFIRM_ALLOW, CONFIRM_DENY]);
    return choice === CONFIRM_ALLOW;
  } catch {
    return false;
  }
}
