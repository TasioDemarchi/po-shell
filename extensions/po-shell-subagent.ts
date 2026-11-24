/**
 * Guard for po-shell subagents.
 *
 * Subagents get a fresh context and only the tools needed for their mission.
 * They must not touch orchestrator state or project Markdown, and a writer is
 * confined to the edit surfaces the parent declared for it.
 */
import { subagentToolBlock } from "../src/subagent-policy.js";

function declaredSurfaces() {
  const raw = process.env.PO_SHELL_SUBAGENT_SURFACES ?? "";
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export default function poShellSubagent(pi: ExtensionAPI) {
  const surfaces = declaredSurfaces();
  pi.on("tool_call", (event, ctx) => {
    const reason = subagentToolBlock(event.toolName, event.input ?? {}, ctx.cwd, { surfaces });
    return reason ? { block: true, reason } : undefined;
  });
}
