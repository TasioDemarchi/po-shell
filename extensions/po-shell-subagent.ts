/**
 * Guard for po-shell subagents.
 *
 * Subagents get a fresh context and only the tools needed for their mission.
 * They must not touch orchestrator state or project Markdown, and a writer is
 * confined to the edit surfaces the parent declared for it.
 *
 * This is also the only extension a child loads (`--no-extensions --extension
 * guardPath`), so the tools a child may call live here: the explorer's read-only
 * memory search is registered below and nowhere else.
 */
import { Type } from "typebox";
import { subagentToolBlock } from "../src/subagent-policy.js";
import { memorySearch } from "../src/subagent-memory.js";

function declaredSurfaces() {
  const raw = process.env.PO_SHELL_SUBAGENT_SURFACES ?? "";
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function declaredOutside() {
  const raw = process.env.PO_SHELL_SUBAGENT_READ_OUTSIDE ?? "";
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function text(value: string) {
  return { content: [{ type: "text" as const, text: value }], details: undefined };
}

function renderMemories(results: any[]) {
  if (!results.length) {
    return "sin resultados en la memoria de este proyecto. La memoria de otros proyectos no se consulta.";
  }
  return results
    .map((item) => `- [${item.type}] ${item.title} (${item.key})\n  ${item.snippet}`)
    .join("\n");
}

export default function poShellSubagent(pi: ExtensionAPI) {
  const surfaces = declaredSurfaces();
  const role = process.env.PO_SHELL_SUBAGENT_ROLE ?? "";
  const readOutside = declaredOutside();
  const scratch = process.env.TMPDIR ?? "";

  // Read-only, project-scoped, no project parameter and no `all_projects`: the
  // active project is the one the child was launched in.
  if (role === "explorer") {
    pi.registerTool({
      name: "memory_search",
      label: "memory_search",
      description:
        "Search the active project's memories (lessons, decisions, behavior rules). Read-only and scoped to this project: it never returns another project's memory. Use it before asking the parent for context; results are compact, so ask again with different words instead of asking for full bodies.",
      parameters: Type.Object({
        query: Type.String({ description: "Terms to search for in the project's memories." }),
        limit: Type.Optional(Type.Number({ description: "How many results, 1..10 (default 5)." })),
      }),
      async execute(_id, params, _signal, _onUpdate, ctx) {
        const { results } = memorySearch(ctx.cwd, {
          query: (params as any).query,
          limit: (params as any).limit,
        });
        return text(renderMemories(results));
      },
    });
  }

  pi.on("tool_call", (event, ctx) => {
    const reason = subagentToolBlock(event.toolName, event.input ?? {}, ctx.cwd, {
      surfaces,
      role,
      readOutside,
      scratch,
    });
    return reason ? { block: true, reason } : undefined;
  });
}
