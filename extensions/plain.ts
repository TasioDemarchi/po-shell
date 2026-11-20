/**
 * Plain — deterministic harness for Pi.
 *
 * This extension is the adapter between Pi and the Plain kernel.
 * The kernel owns state (tasks, memory, reviews, policy, events).
 * Pi owns the model loop.
 */

import { Type } from "typebox";
import path from "node:path";
import { activeDirectives, getContext, searchContext } from "../src/context.js";
import { buildSubagentArgs, runPiJson, usageTotal } from "../src/delegate.js";
import { formatCredits, recordCost } from "../src/costs.js";
import { memoryAction, taskAction } from "../src/tool-defaults.js";
import { PACKAGE_ROOT } from "../src/shell.js";
import { mutatingCommand } from "../src/policy.js";
import { semanticConfig } from "../src/semantic.js";
import {
  activeTask,
  activeTaskId,
  checkPolicy,
  createTask,
  freezeReview,
  getTask,
  init,
  isInitialized,
  listTasks,
  loadConfig,
  plainPath,
  renderContext,
  renderStatus,
  reviewDiff,
  runChecks,
  saveAgentArtifact,
  saveMemory,
  updateTask,
} from "../src/kernel.js";

function text(value: string) {
  return { content: [{ type: "text" as const, text: value }], details: undefined };
}

function snapshotTask(cwd: string, task: any) {
  if (!task) return;
  try {
    saveMemory(cwd, {
      title: `Task state: ${task.id}`,
      what: `${task.title} · ${task.phase} · risk ${task.risk}`,
      why: "Automatic state snapshot for fast resume.",
      where: task.scope || "",
      learned: `next: ${task.next || "(none)"}; evidence: ${(task.evidence ?? []).length}`,
      type: "state",
      scope: "project",
      topic: `state/${task.id}`,
      status: "active",
    });
  } catch {
    // A snapshot must never block the task operation.
  }
}

function taskSummary(task: any) {
  if (!task) return "(sin tarea)";
  return [
    `${task.id} · ${task.phase} · riesgo ${task.risk}`,
    `título: ${task.title}`,
    task.scope ? `scope: ${task.scope}` : "",
    task.outOfScope ? `out of scope: ${task.outOfScope}` : "",
    task.next ? `próximo paso: ${task.next}` : "",
    `evidencia: ${(task.evidence ?? []).length}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export default function plainExtension(pi: ExtensionAPI) {
  let pendingCheckpoint = "";

  pi.registerCommand("semantic", {
    description: "Turn semantic memory search on or off for this session: /semantic on|off",
    handler: async (args, ctx) => {
      const value = String(args ?? "").trim().toLowerCase();
      if (!value) {
        ctx.ui.notify(`Semantic: ${semanticConfig(process.env) ? "on" : "off"}`, "info");
        return;
      }
      if (value !== "on" && value !== "off") {
        ctx.ui.notify("Uso: /semantic on|off", "warning");
        return;
      }
      process.env.PLAIN_SEMANTIC = value;
      const available = Boolean(semanticConfig(process.env));
      ctx.ui.notify(
        `Semantic: ${value}${value === "on" && !available ? " (sin credenciales/modelos Nan)" : ""}`,
        value === "on" && !available ? "warning" : "info",
      );
    },
  });

  pi.registerCommand("plain", {
    description: "Show Plain state (tasks, checks, last frozen review)",
    handler: async (args, ctx) => {
      const cwd = ctx.cwd;
      if (!isInitialized(cwd)) {
        if (String(args).trim() === "init") {
          init(cwd);
          ctx.ui.notify("Plain inicializado", "info");
          return;
        }
        ctx.ui.notify("Plain no está inicializado. Corré: plain init", "warning");
        return;
      }
      ctx.ui.notify(renderStatus(cwd), "info");
    },
  });

  pi.registerTool({
    name: "plain_status",
    label: "Plain status",
    description:
      "Show the current Plain task, phase, risk, evidence count and last frozen review. Use before planning or when unsure what state the work is in.",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      return text(renderStatus(ctx.cwd));
    },
  });

  pi.registerTool({
    name: "plain_task",
    label: "Plain task",
    description:
      "Manage the deterministic work state. Actions: new (title, risk, scope, out_of_scope), phase (id?, phase), approve (id?, high-risk plan), list, show (id?). Risk: low=local reversible/docs; medium=normal behavior; high=auth/permissions/secrets, payments, migrations, public contracts, infra/deploy, concurrency or irreversible actions. High-risk tasks require human plan approval before editing.",
    parameters: Type.Object({
      action: Type.Optional(
        Type.Union([
          Type.Literal("new"),
          Type.Literal("phase"),
          Type.Literal("list"),
          Type.Literal("show"),
          Type.Literal("update"),
          Type.Literal("approve"),
        ]),
      ),
      title: Type.Optional(Type.String()),
      id: Type.Optional(Type.String()),
      phase: Type.Optional(Type.String()),
      risk: Type.Optional(Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")])),
      scope: Type.Optional(Type.String()),
      out_of_scope: Type.Optional(Type.String()),
      next: Type.Optional(Type.String()),
      acceptance: Type.Optional(Type.Array(Type.String())),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const cwd = ctx.cwd;
      const action = taskAction(params);
      try {
        if (action === "approve") {
          const task = params.id ? getTask(cwd, params.id) : activeTask(cwd);
          if (!task) return { ...text("No hay tarea activa para aprobar."), isError: true };
          if (task.risk !== "high") {
            return text(`La tarea ${task.id} no es high-risk; no requiere aprobación de plan.`);
          }
          if (task.planApproved === true) {
            return text(`La tarea ${task.id} ya tiene el plan aprobado.`);
          }
          if (!ctx.hasUI) {
            return {
              ...text("No hay UI para aprobar el plan. La tarea queda bloqueada."),
              isError: true,
            };
          }
          const choice = await ctx.ui.select(
            `Aprobar el plan de la tarea de alto riesgo: ${task.title}`,
            ["Aprobar plan", "Rechazar plan"],
          );
          if (choice !== "Aprobar plan") {
            const blocked = updateTask(cwd, task.id, {
              phase: "blocked",
              next: "Plan rechazado por el humano.",
            });
            snapshotTask(cwd, blocked);
            return { ...text("Plan rechazado. La tarea quedó bloqueada."), isError: true };
          }
          const updated = updateTask(cwd, task.id, {
            planApproved: true,
            phase: "planned",
            next: "Plan aprobado; implementar.",
          });
          snapshotTask(cwd, updated);
          return text(`Plan aprobado.\n${taskSummary(updated)}`);
        }
        if (action === "new") {
          const task = createTask(cwd, {
            title: params.title ?? "",
            risk: params.risk ?? "medium",
            scope: params.scope ?? "",
            outOfScope: params.out_of_scope ?? "",
            acceptance: params.acceptance ?? [],
          });
          snapshotTask(cwd, task);
          const next =
            task.risk === "high"
              ? "\n\nPlan approval pending. Mostrá el plan y llamá plain_task con action=\"approve\". No pidas aprobación por chat."
              : "";
          return text(`Tarea creada.\n${taskSummary(task)}${next}`);
        }
        if (action === "phase") {
          const task = updateTask(cwd, params.id, {
            phase: params.phase,
            next: params.next,
          });
          snapshotTask(cwd, task);
          return text(`Fase actualizada.\n${taskSummary(task)}`);
        }
        if (action === "update") {
          const task = updateTask(cwd, params.id, {
            phase: params.phase,
            risk: params.risk,
            scope: params.scope,
            next: params.next,
          });
          snapshotTask(cwd, task);
          return text(taskSummary(task));
        }
        if (action === "show") {
          return text(taskSummary(params.id ? getTask(cwd, params.id) : activeTask(cwd)));
        }
        const tasks = listTasks(cwd);
        if (!tasks.length) return text("(sin tareas)");
        return text(
          tasks
            .map((t: any) => `${t.id} · ${t.phase} · ${t.risk} · ${t.title}`)
            .join("\n"),
        );
      } catch (error) {
        return { ...text(`Plain error: ${(error as Error).message}`), isError: true };
      }
    },
  });

  pi.registerTool({
    name: "plain_memory",
    label: "Plain memory",
    description:
      "Project memory. Actions: save (title?, what, why?, where?, learned?, topic?, type?, scope?, priority?, trigger?, aliases?, status?), search (query). Types: lesson, state, feature, session, behavior. Use stable topics such as state/<task-id>, feature/<slug> or session/current so snapshots overwrite. Search memory first; if there is no hit or it is stale, read the feature doc. Save a short What/Why/Where/Learned entry after a decision, bug fix, discovery, constraint or user rule. Aliases are optional bilingual search terms, comma-separated. For a human behavior rule use type=behavior, scope=global|project, priority=low|medium|high and an optional trigger.",
    parameters: Type.Object({
      action: Type.Optional(
        Type.Union([Type.Literal("save"), Type.Literal("search")]),
      ),
      query: Type.Optional(Type.String()),
      title: Type.Optional(Type.String()),
      what: Type.Optional(Type.String()),
      why: Type.Optional(Type.String()),
      where: Type.Optional(Type.String()),
      learned: Type.Optional(Type.String()),
      topic: Type.Optional(Type.String()),
      type: Type.Optional(Type.String()),
      scope: Type.Optional(Type.String()),
      priority: Type.Optional(Type.String()),
      trigger: Type.Optional(Type.String()),
      aliases: Type.Optional(Type.String()),
      status: Type.Optional(Type.String()),
      include_global: Type.Optional(Type.Boolean()),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const action = memoryAction(params);
      try {
        if (action === "save") {
          const result = saveMemory(ctx.cwd, {
            title: params.title ?? "",
            what: params.what ?? "",
            why: params.why ?? "",
            where: params.where ?? "",
            learned: params.learned ?? "",
            topic: params.topic ?? "",
            type: params.type ?? "",
            scope: params.scope ?? "",
            priority: params.priority ?? "",
            trigger: params.trigger ?? "",
            aliases: params.aliases ?? "",
            status: params.status ?? "",
          });
          return text(`Memoria guardada: ${result.slug}`);
        }
        const result = await searchContext(ctx.cwd, params.query ?? "", {
          kinds: ["memory"],
          limit: 5,
          allowGlobal: params.include_global === true,
        });
        if (!result.results.length) {
          return text(
            result.globalBlocked
              ? "Global memory found. Stop and ask the user; call again with include_global=true only after confirmation."
              : "(sin resultados)",
          );
        }
        const lines = result.results.map(
          (item: any) => `## ${item.id} · ${item.title}\n${item.snippet}`,
        );
        if (result.requiresConfirmation) {
          lines.unshift("WARN: global memory found. Stop and ask the user before using it.");
        }
        return text(lines.join("\n\n"));
      } catch (error) {
        return { ...text(`Plain error: ${(error as Error).message}`), isError: true };
      }
    },
  });

  pi.registerTool({
    name: "context_search",
    label: "Context search",
    description:
      "Search memories first, then project specs when memory has no hit or lacks detail. Returns compact previews with stable IDs. Use before substantial work and when the user asks to recall or resume. Memories are global: the current project is searched first, then the rest. If a result has requiresConfirmation=true, it is a global memory: stop and ask the user before using it; pass include_global=true only after the user confirms. Set project to search a registered project from any cwd. Set all_projects=true only when you need lessons from other projects; specs still come from the selected/current project.",
    parameters: Type.Object({
      query: Type.String(),
      kinds: Type.Optional(
        Type.Array(Type.Union([Type.Literal("spec"), Type.Literal("memory")])),
      ),
      type: Type.Optional(Type.String()),
      limit: Type.Optional(Type.Number()),
      project: Type.Optional(Type.String()),
      all_projects: Type.Optional(Type.Boolean()),
      include_global: Type.Optional(Type.Boolean()),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      try {
        const result = await searchContext(ctx.cwd, params.query, {
          project: params.project,
          kinds: params.kinds,
          type: params.type,
          limit: params.limit,
          allProjects: params.all_projects,
          allowGlobal: params.include_global === true,
        });
        if (!result.results.length) {
          return text(
            result.globalBlocked
              ? "Global memory found. Stop and ask the user; call again with include_global=true only after confirmation."
              : "(sin resultados)",
          );
        }
        const lines = result.results.map((item: any) => {
          const label =
            item.kind === "spec"
              ? `${item.id} · ${item.breadcrumb}`
              : `${item.id} · ${item.project ?? "proyecto"} · ${item.type} · ${item.title}`;
          return `[${item.kind}] ${label}\n  ${item.snippet.replace(/\s+/g, " ").trim()}`;
        });
        if (result.requiresConfirmation) {
          lines.unshift(
            "WARN: global memory found. Stop and ask the user before using it.",
          );
        }
        return text(lines.join("\n\n"));
      } catch (error) {
        return { ...text(`Plain error: ${(error as Error).message}`), isError: true };
      }
    },
  });

  pi.registerTool({
    name: "context_get",
    label: "Context get",
    description:
      "Fetch the full content of one spec section or one memory by its stable ID returned from context_search. IDs can be mem:key, mem:global:key or mem:project:<id>:key. Use only after choosing a result; do not fetch every result.",
    parameters: Type.Object({
      kind: Type.Union([Type.Literal("spec"), Type.Literal("memory")]),
      id: Type.String(),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      try {
        const item = getContext(ctx.cwd, { kind: params.kind, id: params.id });
        const header =
          item.kind === "spec"
            ? `[spec] ${item.path}#${item.ordinal} · ${item.breadcrumb} (L${item.lineStart}-L${item.lineEnd})`
            : `[memory] ${item.id} · ${item.project ?? "proyecto"} · ${item.type} · ${item.title}`;
        return text(`${header}\n\n${item.content}`);
      } catch (error) {
        return { ...text(`Plain error: ${(error as Error).message}`), isError: true };
      }
    },
  });

  pi.registerTool({
    name: "plain_check",
    label: "Plain check",
    description:
      "Run the configured deterministic checks (tests, lint, typecheck) and record the result as evidence on the active task. Use before saying work is ready. Optional commands override the checks in the project's central Plain config.",
    parameters: Type.Object({
      commands: Type.Optional(Type.Array(Type.String())),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      try {
        const result = runChecks(ctx.cwd, params.commands ?? null);
        snapshotTask(ctx.cwd, activeTask(ctx.cwd));
        const lines = result.results.map(
          (r: any) => `${r.ok ? "PASS" : "FAIL"} ${r.command} (exit ${r.exitCode}, ${r.ms}ms)`,
        );
        const failed = result.results.filter((r: any) => !r.ok);
        if (failed.length) {
          lines.push("", "Salida del primer fallo:", failed[0].output);
        }
        return { ...text(lines.join("\n")), isError: !result.ok };
      } catch (error) {
        return { ...text(`Plain error: ${(error as Error).message}`), isError: true };
      }
    },
  });

  pi.registerTool({
    name: "plain_review",
    label: "Plain review",
    description:
      "Freeze the exact current candidate (git diff + untracked files) and return its hash, risk and stats. Actions: freeze (base?), show (id?, include_diff?). Use before a risky delivery; the freeze is what a reviewer should inspect.",
    parameters: Type.Object({
      action: Type.Union([Type.Literal("freeze"), Type.Literal("show")]),
      base: Type.Optional(Type.String()),
      id: Type.Optional(Type.String()),
      include_diff: Type.Optional(Type.Boolean()),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      try {
        if (params.action === "freeze") {
          const meta = freezeReview(ctx.cwd, { base: params.base ?? "HEAD" });
          return text(
            [
              `Review congelado: ${meta.id}`,
              `hash: ${meta.hash}`,
              `riesgo: ${meta.risk}`,
              `archivos: ${meta.files.length}`,
              `+${meta.added} / -${meta.deleted}`,
              `diff: ${path.join(plainPath(ctx.cwd), "reviews", meta.id, "diff.patch")}`,
            ].join("\n"),
          );
        }
        const { meta, diff } = reviewDiff(ctx.cwd, params.id ?? null);
        return text(
          [
            JSON.stringify(meta, null, 2),
            params.include_diff ? `\n--- DIFF ---\n${diff.slice(0, 60_000)}` : "",
          ].join("\n"),
        );
      } catch (error) {
        return { ...text(`Plain error: ${(error as Error).message}`), isError: true };
      }
    },
  });

  pi.registerTool({
    name: "plain_ask",
    label: "Plain ask",
    description:
      "Ask the human a decision that the agent must not make alone. Use only for scope changes, destructive actions, security exposure or delivery. Returns the chosen option.",
    parameters: Type.Object({
      question: Type.String(),
      options: Type.Array(Type.String()),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      if (!ctx.hasUI) {
        return {
          ...text("No hay UI para preguntar. La decisión queda bloqueada."),
          isError: true,
        };
      }
      const choice = await ctx.ui.select(params.question, params.options);
      if (!choice) return { ...text("El humano canceló la decisión."), isError: true };
      return text(`Decisión humana: ${choice}`);
    },
  });

  const subagentGuard = path.join(PACKAGE_ROOT, "extensions", "plain-subagent.ts");
  const subagentPrompt = path.join(PACKAGE_ROOT, "prompts", "plain-subagent.md");

  pi.registerTool({
    name: "plain_delegate",
    label: "Plain delegate",
    description:
      "Run one bounded subagent in a separate Pi process with a fresh, isolated context. The child gets only the mission prompt, allowed tools, a role model and a minimal subagent protocol: no global AGENTS.md, no Plain memory/task tools, and no writes to .md or the central Plain state. Supports token/turn budgets, timeout and audit artifacts under the central Plain state directory. Returns the child's final text; the parent must verify it, not trust it.",
    parameters: Type.Object({
      role: Type.Union([
        Type.Literal("explorer"),
        Type.Literal("planner"),
        Type.Literal("worker"),
        Type.Literal("reviewer"),
      ]),
      task: Type.String(),
      tools: Type.Optional(Type.Array(Type.String())),
      model: Type.Optional(Type.String()),
      timeout_seconds: Type.Optional(Type.Number()),
      max_tokens: Type.Optional(Type.Number()),
      max_turns: Type.Optional(Type.Number()),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const defaults: Record<string, string[]> = {
        explorer: ["read", "grep", "find", "ls"],
        planner: ["read", "grep", "find", "ls"],
        reviewer: ["read", "grep", "find", "ls"],
        worker: ["read", "bash", "edit", "write", "grep", "find", "ls"],
      };
      const tools = params.tools?.length ? params.tools : defaults[params.role] ?? defaults.worker;
      let model = params.model;
      if (!model) {
        try {
          model = loadConfig(ctx.cwd).models?.[params.role];
        } catch {
          model = undefined;
        }
      }
      const prompt = [
        `You are a Plain subagent with role: ${params.role}.`,
        "Work on exactly the mission below. Do not expand scope.",
        "Do not commit, push, deploy, or change credentials.",
        "Return a compact result: what you did, evidence, files touched, open questions.",
        "",
        "MISSION:",
        params.task,
      ].join("\n");
      const args = buildSubagentArgs({
        guardPath: subagentGuard,
        promptPath: subagentPrompt,
        tools,
        model,
        mission: prompt,
      });
      const timeoutMs = Math.max(10, Math.min(3600, params.timeout_seconds ?? 300)) * 1000;
      const started = Date.now();
      try {
        const result = await runPiJson(ctx.cwd, args, {
          signal: _signal,
          maxTokens: params.max_tokens,
          maxTurns: params.max_turns,
          timeoutMs,
        });
        const output = result.text.trim() || result.stderr.trim() || "(sin salida)";
        const runId = `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        let artifact = null;
        if (isInitialized(ctx.cwd)) {
          try {
            artifact = saveAgentArtifact(ctx.cwd, {
              id: runId,
              output,
              events: result.events,
              meta: {
                role: params.role,
                task: params.task.slice(0, 4000),
                model: model ?? null,
                tools,
                status: result.status,
                exitCode: result.code,
                ms: Date.now() - started,
                usage: result.usage,
                totalUsage: result.totalUsage,
                totalTokens: total,
                credits: subagentCost?.credits ?? null,
                turns: result.turns,
                maxTokens: params.max_tokens ?? null,
                maxTurns: params.max_turns ?? null,
                timeoutSeconds: params.timeout_seconds ?? 300,
              },
            });
          } catch {
            // El artefacto es auditoría; no debe tumbar la delegación.
          }
        }
        const usage = result.totalUsage ?? result.usage ?? {};
        const total = usageTotal(usage);
        const costModel = model ?? (ctx.model as any)?.id ?? (ctx.model as any)?.name ?? "unknown";
        let subagentCost: any = null;
        if (isInitialized(ctx.cwd)) {
          try {
            const taskId = activeTaskId(ctx.cwd);
            const task = taskId ? getTask(ctx.cwd, taskId) : null;
            subagentCost = recordCost(ctx.cwd, {
              usage,
              model: costModel,
              role: params.role,
              source: "subagent",
              taskId: task?.id ?? null,
              taskTitle: task?.title ?? null,
            });
          } catch {
            // El ledger no debe romper la delegación.
          }
        }
        return {
          ...text(
            [
              `role: ${params.role}`,
              `status: ${result.status}`,
              `exit: ${result.code}`,
              `ms: ${Date.now() - started}`,
              `turns: ${result.turns}`,
              `tools: ${tools.join(",")}`,
              `usage: input=${usage.input ?? 0} output=${usage.output ?? 0} cache=${(usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0)} total=${total}`,
              `credits: ${subagentCost ? formatCredits(subagentCost.credits) : "n/a"}`,
              `model: ${costModel || "(default)"}`,
              `budget: max_tokens=${params.max_tokens ?? 0} max_turns=${params.max_turns ?? 0}`,
              `artifact: ${artifact ? artifact.resultPath : "(no guardado)"}`,
              "",
              output.slice(-40_000),
            ].join("\n"),
          ),
          isError: result.status !== "ok",
        };
      } catch (error) {
        return { ...text(`Plain delegate error: ${(error as Error).message}`), isError: true };
      }
    },
  });

  pi.on("tool_call", async (event, ctx) => {
    if (!isInitialized(ctx.cwd)) return undefined;
    try {
      const verdict = checkPolicy(ctx.cwd, event.toolName, event.input ?? {});
      if (verdict.block) return { block: true, reason: verdict.reason };
      const task = activeTask(ctx.cwd);
      if (task?.risk === "high" && task.planApproved !== true) {
        const writesFile = event.toolName === "edit" || event.toolName === "write";
        const writesShell =
          event.toolName === "bash" && mutatingCommand(event.input?.command);
        if (writesFile || writesShell) {
          return {
            block: true,
            reason:
              "High-risk task requires plan approval. Show the plan and call plain_task with action=approve before editing.",
          };
        }
      }
      return undefined;
    } catch (error) {
      // Fail closed: if the policy cannot be evaluated, do not run the tool.
      return { block: true, reason: `Plain policy error: ${(error as Error).message}` };
    }
  });

  pi.on("message_end", async (event, ctx) => {
    const message = event.message as any;
    if (!isInitialized(ctx.cwd)) return;
    if (message?.role !== "assistant" || !message.usage) return;
    try {
      const taskId = activeTaskId(ctx.cwd);
      const task = taskId ? getTask(ctx.cwd, taskId) : null;
      recordCost(ctx.cwd, {
        usage: message.usage,
        model: (ctx.model as any)?.id ?? (ctx.model as any)?.name ?? "unknown",
        role: "orchestrator",
        source: "chat",
        taskId: task?.id ?? null,
        taskTitle: task?.title ?? null,
      });
    } catch {
      // El ledger no debe romper el loop del agente.
    }
  });

  pi.on("session_before_compact", async (event, ctx) => {
    try {
      const task = activeTask(ctx.cwd);
      const lines = [
        "<plain_checkpoint>",
        `reason: ${event.reason}`,
        `created: ${new Date().toISOString()}`,
        task
          ? `task: ${task.id} · ${task.phase} · risk ${task.risk} · ${task.title}`
          : "task: none",
        task?.next ? `next: ${task.next}` : "",
        task?.scope ? `scope: ${task.scope}` : "",
        task?.outOfScope ? `out_of_scope: ${task.outOfScope}` : "",
        task ? `evidence: ${(task.evidence ?? []).length}` : "",
        "</plain_checkpoint>",
      ].filter(Boolean);
      pendingCheckpoint = lines.join("\n");
      if (task) {
        saveMemory(ctx.cwd, {
          title: "Session checkpoint",
          what: `Compaction checkpoint for ${task.id}.`,
          why: `Automatic checkpoint before compaction (${event.reason}).`,
          where: "",
          learned: `phase: ${task.phase}; next: ${task.next || "(none)"}`,
          type: "session",
          scope: "project",
          topic: "session/current",
          status: "active",
        });
      }
    } catch {
      // Checkpointing must never block compaction.
    }
  });

  pi.on("session_compact", async () => {
    // The checkpoint is injected on the next before_agent_start.
  });

  pi.on("session_compact_failed", async () => {
    pendingCheckpoint = "";
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    if (!isInitialized(ctx.cwd)) return undefined;
    const content = renderContext(ctx.cwd);
    let directives: any[] = [];
    try {
      directives = activeDirectives(ctx.cwd);
    } catch {
      // Una directiva rota no debe bloquear la sesión.
    }
    const directiveBlock = directives.length
      ? [
          "<plain_directives>",
          ...directives.map(
            (item: any) =>
              `- [${item.scope}, ${item.priority}] ${item.rule}${item.trigger ? ` (cuando: ${item.trigger})` : ""}`,
          ),
          "</plain_directives>",
        ].join("\n")
      : "";
    const parts = [content, directiveBlock, pendingCheckpoint].filter(Boolean);
    pendingCheckpoint = "";
    if (!parts.length) return undefined;
    return {
      message: {
        customType: "plain-context",
        content: parts.join("\n\n"),
        display: false,
      },
    };
  });
}
