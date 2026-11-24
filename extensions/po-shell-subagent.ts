/**
 * Guard for po-shell subagents.
 *
 * Subagents get a fresh context and only the tools needed for their mission.
 * They must not touch orchestrator state or project Markdown.
 */
import { subagentToolBlock } from "../src/subagent-policy.js";

export default function poShellSubagent(pi: ExtensionAPI) {
  pi.on("tool_call", (event, ctx) => {
    const reason = subagentToolBlock(event.toolName, event.input ?? {}, ctx.cwd);
    return reason ? { block: true, reason } : undefined;
  });
}
