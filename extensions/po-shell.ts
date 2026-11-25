/**
 * po-shell — deterministic harness for Pi.
 *
 * This extension is the adapter between Pi and the po-shell kernel.
 * The kernel owns state (tasks, memory, reviews, policy, events).
 * Pi owns the model loop.
 */

import { Type } from "typebox";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { Container, Text } from "@earendil-works/pi-tui";
import {
  contextLabel,
  creditLabel,
  dirtyCount,
  footerLine,
  formatCall,
  formatResult,
  gitLabel,
  homePath,
  modelLabel,
  oneLine,
  panelRows,
  resultText,
  shouldShowPanel,
  shortModel,
  taskLabel,
} from "../src/minimal-ui.js";
import { applyUiMode, panelMode, setPanelMode, uiMode } from "../src/ui.js";
import { activeDirectives, getContext, searchContext } from "../src/context.js";
import { confirmDestructive, planApprovalTitle, PLAN_APPROVE, PLAN_REJECT } from "../src/confirm.js";
import { buildSubagentArgs, capReport, delegationMeta, runPiJson, usageTotal } from "../src/delegate.js";
import { formatCredits, costSummary, recordCost } from "../src/costs.js";
import { createSubagentScratch } from "../src/scratch.js";
import { memoryAction, taskAction } from "../src/tool-defaults.js";
import { PACKAGE_ROOT } from "../src/shell.js";
import { mutatingCommand } from "../src/policy.js";
import { semanticConfig } from "../src/semantic.js";
import { planLines, sessionMetrics, statsLines } from "../src/stats.js";
import { windowFrame, windowWidth } from "../src/window.js";
import { fetchUsage } from "../src/nan-usage.js";
import {
  activeTask,
  attributableTask,
  checkPolicy,
  createTask,
  freezeReview,
  getTask,
  init,
  isInitialized,
  listTasks,
  loadConfig,
  latestReview,
  taskLabelOf,
  messagePromptTokens,
  saveContextPressure,
  poShellPath,
  readContextPressure,
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
    `${taskLabelOf(task)} · ${task.id} · ${task.phase} · riesgo ${task.risk}`,
    `título: ${task.title}`,
    task.scope ? `scope: ${task.scope}` : "",
    task.outOfScope ? `out of scope: ${task.outOfScope}` : "",
    task.planSummary ? `resumen: ${task.planSummary}` : "",
    task.plan ? `plan:
${task.plan}` : "",
    `delegación: ${task.delegation ?? "inline"}`,
    task.next ? `próximo paso: ${task.next}` : "",
    `evidencia: ${(task.evidence ?? []).length}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export default function poShellExtension(pi: ExtensionAPI) {
  let pendingCheckpoint = "";

  /* ------------------------------- display ------------------------------- */

  // The mode is read at render time, so `/ui` switches without a reload.
  let minimal = uiMode(process.env) === "minimal";

  /* -------------------------------- footer -------------------------------- */

  // Session credits: the orchestrator's own turns, as Pi reports them. Children
  // need `session_id` on cost_events, which is phase 2 of the design.
  let sessionCredits = 0;
  let sessionCreditsKnown = true;

  const GIT_TTL_MS = 2000;
  const TASK_TTL_MS = 1000;
  let gitCache: { cwd: string; at: number; branch: string; dirty: number } | null = null;
  let taskCache: { cwd: string; at: number; task: any } | null = null;

  /** Pi's session id, so costs can be summed per session, orchestrator plus children. */
  function sessionIdOf(ctx: any) {
    try {
      return String(ctx.sessionManager?.getSessionId?.() ?? "").trim();
    } catch {
      return "";
    }
  }

  function addSessionCredits(cost: any) {
    if (!cost) return;
    sessionCredits += Number(cost.credits) || 0;
    if (!cost.known) sessionCreditsKnown = false;
  }

  /** Branch and dirty count. The footer renders on every frame, so this caches. */
  function gitState(cwd: string, branch: string) {
    const now = Date.now();
    if (gitCache && gitCache.cwd === cwd && now - gitCache.at < GIT_TTL_MS) return gitCache;
    const name = oneLine(branch, 40);
    let dirty = 0;
    try {
      dirty = dirtyCount(
        execFileSync("git", ["status", "--porcelain"], {
          cwd,
          encoding: "utf8",
          timeout: 1500,
          stdio: ["ignore", "pipe", "ignore"],
        }),
      );
    } catch {
      // Not a repository, or no git on PATH: the branch alone has to do.
    }
    gitCache = { cwd, at: now, branch: name, dirty };
    return gitCache;
  }

  function currentTask(cwd: string) {
    const now = Date.now();
    if (taskCache && taskCache.cwd === cwd && now - taskCache.at < TASK_TTL_MS) return taskCache.task;
    let task: any = null;
    try {
      task = activeTask(cwd);
    } catch {
      task = null;
    }
    taskCache = { cwd, at: now, task };
    return task;
  }

  /* --------------------------------- panel --------------------------------- */

  // `auto` means "do not exist while everything is normal": the panel is a
  // reaction to an anomaly, not a decoration above the editor.
  const PANEL_ID = "po-shell";
  let panel = panelMode(process.env);
  const liveChildren = new Map<string, { role: string; startedAt: number }>();
  let panelTimer: any = null;

  function lastChecks(task: any) {
    const entries = Array.isArray(task?.evidence) ? task.evidence : [];
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      if (entry?.kind !== "checks" || !Array.isArray(entry.results)) continue;
      const total = entry.results.length;
      const failed = entry.results.filter((result: any) => !result?.ok).length;
      return { total, failed, passed: total - failed, ok: entry.ok !== false };
    }
    return null;
  }

  function panelState(ctx: any) {
    const task = currentTask(ctx.cwd);
    let contextLevel = "ok";
    try {
      contextLevel = readContextPressure(ctx.cwd)?.level ?? "ok";
    } catch {
      contextLevel = "ok";
    }
    let review: any = null;
    try {
      review = latestReview(ctx.cwd);
    } catch {
      review = null;
    }
    const checks = lastChecks(task);
    return {
      mode: panel,
      task,
      children: [...liveChildren.values()].map((child) => ({
        role: child.role,
        elapsedMs: Date.now() - child.startedAt,
      })),
      checks,
      lastCheckFailed: Boolean(checks && (checks.failed > 0 || checks.ok === false)),
      pendingHighPlan: Boolean(
        task && task.risk === "high" && task.planApproved !== true && task.phase === "planned",
      ),
      contextLevel,
      review: review?.id ? { id: review.id } : null,
      dirty: gitState(ctx.cwd, "").dirty,
    };
  }

  function applyPanel(ctx: any) {
    if (!ctx.hasUI) return;
    const state = panelState(ctx);
    const rows = shouldShowPanel(state)
      ? panelRows(state, { width: Number(process.stdout.columns) || 0 })
      : [];
    ctx.ui.setWidget(PANEL_ID, rows.length ? rows : undefined);
  }

  /** A ticker only while a child runs: idle panels must not repaint the screen. */
  function startPanelTicker(ctx: any) {
    if (panelTimer || liveChildren.size === 0) return;
    panelTimer = setInterval(() => {
      if (liveChildren.size === 0) {
        clearInterval(panelTimer);
        panelTimer = null;
        return;
      }
      try {
        applyPanel(ctx);
      } catch {
        // Un panel que falla no debe romper la sesión.
      }
    }, 1000);
    panelTimer.unref?.();
  }

  function trackChild(role: string) {
    const id = `${role}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
    liveChildren.set(id, { role, startedAt: Date.now() });
    return id;
  }

  /**
   * One line, replacing Pi's footer rather than sitting under it: two bars is
   * one bar too many. `full` restores the native one.
   */
  function applyFooter(ctx: any) {
    if (!ctx.hasUI) return;
    if (!minimal) {
      ctx.ui.setFooter(undefined);
      return;
    }
    ctx.ui.setFooter((_tui: any, theme: any, footerData: any) => ({
      render(width: number) {
        const git = gitState(ctx.cwd, footerData?.getGitBranch?.() ?? "");
        const usage = ctx.getContextUsage?.();
        const model = (ctx.model as any)?.id ?? (ctx.model as any)?.name ?? "";
        const parts = {
          left: [
            { text: homePath(ctx.cwd), compact: path.basename(ctx.cwd) },
            { text: gitLabel(git.branch, git.dirty), compact: git.branch },
            { text: taskLabel(currentTask(ctx.cwd)) },
          ],
          right: [
            { text: creditLabel(sessionCredits, { known: sessionCreditsKnown }), keep: true },
            { text: contextLabel(usage?.percent), keep: true },
            { text: modelLabel(model, ctx.thinkingLevel), compact: shortModel(model) },
          ],
        };
        return [theme.fg("dim", footerLine(parts, { width }))];
      },
      invalidate() {},
    }));
  }

  function applyUi(ctx: any) {
    if (!ctx.hasUI) return;
    ctx.ui.setToolsExpanded(!minimal);
    if (minimal) {
      ctx.ui.setHiddenThinkingLabel("… thinking…");
      ctx.ui.setWorkingIndicator({
        frames: ["·  ", "·· ", "···"],
        intervalMs: 280,
      });
    } else {
      ctx.ui.setHiddenThinkingLabel();
      ctx.ui.setWorkingIndicator();
    }
    applyFooter(ctx);
    applyPanel(ctx);
  }

  pi.on("session_start", async (_event, ctx) => {
    minimal = uiMode(process.env) === "minimal";
    applyUi(ctx);
  });

  pi.registerCommand("ui", {
    description: "Cambiar la estética: /ui minimal | /ui full",
    handler: async (args, ctx) => {
      const value = String(args ?? "")
        .trim()
        .toLowerCase();
      if (!value) {
        ctx.ui.notify(`UI: ${minimal ? "minimal" : "full"}`, "info");
        return;
      }
      try {
        const result = applyUiMode(value, process.env);
        minimal = result.mode === "minimal";
        applyUi(ctx);
        const thinking = result.changed ? " · thinking applies next session (or ctrl+t)" : "";
        ctx.ui.notify(`UI: ${result.mode}${thinking}`, "info");
      } catch (error) {
        ctx.ui.notify(String((error as Error).message), "warning");
      }
    },
  });

  // One line per tool call. Collapsed is ours; expanded delegates to Pi, so
  // ctrl+o still shows the native command, output and diff.
  pi.registerToolRenderer((toolName: string, next: any) => {
    const base = next();
    return {
      // `self` takes the row out of Pi's Box, and that Box is what paints
      // toolPendingBg / toolSuccessBg / toolErrorBg behind every call: the green
      // and red blocks. We draw plain text lines instead.
      ...(minimal ? { renderShell: "self" as const } : {}),
      renderCall(args: any, theme: any, context: any) {
        if (!minimal) return base?.renderCall?.(args, theme, context) ?? new Text(toolName, 0, 0);
        if (context.expanded && base?.renderCall) return base.renderCall(args, theme, context);
        const call = formatCall(toolName, args ?? {}, { cwd: context.cwd });
        const label = call.label ? theme.fg("dim", call.label) : "";
        const head = call.text ? `${label}${label ? theme.fg("dim", " · ") : ""}${theme.fg("text", call.text)}` : label;
        const meta = call.meta ? `  ${theme.fg("dim", call.meta)}` : "";
        return new Text(`${theme.fg(call.tone, call.icon)} ${head}${meta}`, 0, 0);
      },
      renderResult(result: any, options: any, theme: any, context: any) {
        const expanded = options?.expanded ?? context?.expanded;
        if (!minimal) return base?.renderResult?.(result, options, theme, context) ?? new Container();
        if (expanded && base?.renderResult) return base.renderResult(result, options, theme, context);
        if (expanded) {
          const full = resultText(result);
          return full ? new Text(full.split("\n").map((line) => theme.fg("toolOutput", line)).join("\n"), 0, 0) : new Container();
        }
        const rows = formatResult(toolName, context?.args ?? {}, result, {
          isPartial: options?.isPartial,
          isError: context?.isError,
          durationMs: context?.durationMs,
        });
        if (!rows.length) return new Container();
        return new Text(rows.map((row) => theme.fg(row.tone, row.text)).join("\n"), 0, 0);
      },
    };
  });

  pi.registerCommand("semantic", {
    description: "Turn semantic memory search on or off for this session: /semantic on|off",
    handler: async (args, ctx) => {
      const value = String(args ?? "").trim().toLowerCase();
      if (!value) {
        ctx.ui.notify(`Semantic: ${semanticConfig(process.env) ? "on" : "off"}`, "info");
        return;
      }
      if (value !== "on" && value !== "off") {
        ctx.ui.notify("Usage: /semantic on|off", "warning");
        return;
      }
      process.env.PO_SHELL_SEMANTIC = value;
      const available = Boolean(semanticConfig(process.env));
      ctx.ui.notify(
        `Semantic: ${value}${value === "on" && !available ? " (no Nan credentials/models)" : ""}`,
        value === "on" && !available ? "warning" : "info",
      );
    },
  });

  pi.registerCommand("po-shell", {
    description: "Show po-shell state (tasks, checks, last frozen review)",
    handler: async (args, ctx) => {
      const cwd = ctx.cwd;
      if (!isInitialized(cwd)) {
        if (String(args).trim() === "init") {
          init(cwd);
          ctx.ui.notify("po-shell initialized", "info");
          return;
        }
        ctx.ui.notify("po-shell is not initialized. Run: po-shell init", "warning");
        return;
      }
      ctx.ui.notify(renderStatus(cwd), "info");
    },
  });

  // `/usage` and `/plan` open a window over the chat instead of printing into
  // it: the numbers are a detour, not part of the conversation. esc closes it,
  // and it only paints: nothing reaches the model's context.
  //
  // The body is final before the window opens. An overlay keeps the width it was
  // created with, so growing it later (`fetching…` → four model rows) left a box
  // too narrow for its own content, with every row cut.
  function openWindow(ctx: any, options: { title: string; body: string[]; hint?: string }) {
    const hint = options.hint ?? "esc close";
    const body = options.body;
    if (ctx.mode !== "tui" || !ctx.hasUI) {
      // No TUI to draw on: the numbers still have to be reachable somehow.
      ctx.ui.notify(body.join("\n"), "info");
      return Promise.resolve();
    }

    // As wide as the content and no wider, capped by the terminal: an overlay
    // that fills a percentage paints over chat lines it is not talking about.
    const columns = Number(process.stdout.columns) || 0;
    const wanted = windowWidth({ title: options.title, body, hint });
    const width = columns > 20 ? Math.min(wanted, columns - 2) : wanted;

    return ctx.ui.custom(
      (tui: any, theme: any, keybindings: any, done: (value?: unknown) => void) => ({
        render() {
          return windowFrame({ title: options.title, body, hint, width }).map((row: any) =>
            theme.fg(row.kind === "border" || row.kind === "hint" ? "dim" : "text", row.text),
          );
        },
        handleInput(data: string) {
          if (keybindings.matches(data, "tui.select.cancel") || data === "q") done(undefined);
        },
        invalidate() {},
      }),
      {
        overlay: true,
        overlayOptions: { width, anchor: "center", margin: 1 },
        blocked: { kind: "question", message: options.title },
      },
    );
  }

  pi.registerCommand("usage", {
    description: "Créditos, tokens y modelos de la sesión (ventana, no entra al contexto)",
    handler: async (_args, ctx) => {
      const cwd = ctx.cwd;
      if (!isInitialized(cwd)) {
        ctx.ui.notify("po-shell is not initialized. Run: po-shell init", "warning");
        return;
      }
      try {
        const cost = costSummary({ sessionId: sessionIdOf(ctx), env: process.env });
        const lines = statsLines({
          session: sessionMetrics(ctx.sessionManager?.getEntries?.() ?? []),
          cost,
        });
        await openWindow(ctx, {
          title: "usage",
          body: lines.length ? lines : ["(nothing recorded yet)"],
        });
      } catch (error) {
        ctx.ui.notify(String((error as Error).message), "warning");
      }
    },
  });

  // The subscription lives upstream: 60 s of cache, because two calls per
  // `/plan` are two network round trips and the number does not move that fast.
  const PLAN_TTL_MS = 60_000;
  let planCache: { at: number; value: any } | null = null;

  pi.registerCommand("plan", {
    description: "Créditos de la suscripción Nan: disponibles, renovación y por modelo",
    handler: async (_args, ctx) => {
      let usage: any;
      if (!planCache || Date.now() - planCache.at > PLAN_TTL_MS) {
        // Two network calls: say so, or the terminal looks hung for two seconds.
        ctx.ui.notify("plan: fetching from Nan…", "info");
        try {
          planCache = { at: Date.now(), value: await fetchUsage({ env: process.env }) };
        } catch (error) {
          planCache = { at: Date.now(), value: { ok: false, reason: String((error as Error).message) } };
        }
      }
      usage = planCache.value;
      await openWindow(ctx, { title: "plan", body: planLines(usage) });
    },
  });

  pi.registerCommand("panel", {
    description: "Panel de tarea e hijos: /panel on | off | auto",
    handler: async (args, ctx) => {
      const value = String(args ?? "")
        .trim()
        .toLowerCase();
      if (!value) {
        ctx.ui.notify(`Panel: ${panel}`, "info");
        return;
      }
      try {
        panel = setPanelMode(value, process.env);
        applyPanel(ctx);
        ctx.ui.notify(`Panel: ${panel}`, "info");
      } catch (error) {
        ctx.ui.notify(String((error as Error).message), "warning");
      }
    },
  });

  // The same toggle without typing: on shows it, off hides it. `auto` is one
  // command away, because the shortcut is the emergency hatch.
  pi.registerShortcut("ctrl+shift+p", {
    description: "Toggle the po-shell panel",
    handler: async (ctx) => {
      try {
        panel = setPanelMode(panel === "off" ? "on" : "off", process.env);
        applyPanel(ctx);
        ctx.ui.notify(`Panel: ${panel}`, "info");
      } catch (error) {
        ctx.ui.notify(String((error as Error).message), "warning");
      }
    },
  });

  pi.registerTool({
    name: "po_shell_status",
    label: "po-shell status",
    description:
      "Show the current po-shell task, phase, risk, evidence count and last frozen review. Use before planning or when unsure what state the work is in.",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      return text(renderStatus(ctx.cwd));
    },
  });

  pi.registerTool({
    name: "po_shell_task",
    label: "po-shell task",
    description:
      "Manage the deterministic work state. Actions: new (title, risk, scope, out_of_scope, plan), phase (id?, phase), approve (id?, high-risk plan), list, show (id?). Risk: low=local reversible/docs; medium=normal behavior; high=auth/permissions/secrets, payments, migrations, public contracts, infra/deploy, concurrency or irreversible actions. High-risk tasks require a saved plan and human approval before editing: `plan` carries the detailed plan you explain in your reply, `plan_summary` is one or two lines for the approval dialogue. Delegation profile: inline (default, the parent implements) or delegate-writes (the parent decides, explores, writes docs/features and commits; every code mutation goes to a bounded worker with surfaces).",
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
      id: Type.Optional(
        Type.String({
          description: "Task id, or its human number (`#12` or `12`) as shown in the panel and `po-shell task list`.",
        }),
      ),
      phase: Type.Optional(Type.String()),
      risk: Type.Optional(Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")])),
      scope: Type.Optional(Type.String()),
      out_of_scope: Type.Optional(Type.String()),
      plan: Type.Optional(Type.String()),
      plan_summary: Type.Optional(Type.String()),
      next: Type.Optional(Type.String()),
      acceptance: Type.Optional(Type.Array(Type.String())),
      delegation: Type.Optional(
        Type.Union([Type.Literal("inline"), Type.Literal("delegate-writes")]),
      ),
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
          if (!String(task.plan ?? "").trim()) {
            return {
              ...text(
                `La tarea ${task.id} no tiene plan guardado. Guardalo con po_shell_task action="update" plan="..." y mostralo antes de pedir aprobación.`,
              ),
              isError: true,
            };
          }
          if (!ctx.hasUI) {
            return {
              ...text("No hay UI para aprobar el plan. La tarea queda bloqueada."),
              isError: true,
            };
          }
          const choice = await ctx.ui.select(planApprovalTitle(task), [PLAN_APPROVE, PLAN_REJECT]);
          if (choice !== PLAN_APPROVE) {
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
            plan: params.plan ?? "",
            planSummary: params.plan_summary,
            delegation: params.delegation,
          });
          snapshotTask(cwd, task);
          const next =
            task.risk === "high"
              ? "\n\nPlan approval pending. Mostrá el plan y llamá po_shell_task con action=\"approve\". No pidas aprobación por chat."
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
            plan: params.plan,
            planSummary: params.plan_summary,
            delegation: params.delegation,
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
            .map((t: any) => `${taskLabelOf(t)} · ${t.phase} · ${t.risk} · ${t.title}`)
            .join("\n"),
        );
      } catch (error) {
        return { ...text(`po-shell error: ${(error as Error).message}`), isError: true };
      }
    },
  });

  pi.registerTool({
    name: "po_shell_memory",
    label: "po-shell memory",
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
        return { ...text(`po-shell error: ${(error as Error).message}`), isError: true };
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
        return { ...text(`po-shell error: ${(error as Error).message}`), isError: true };
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
        return { ...text(`po-shell error: ${(error as Error).message}`), isError: true };
      }
    },
  });

  pi.registerTool({
    name: "po_shell_check",
    label: "po-shell check",
    description:
      "Run the configured deterministic checks (tests, lint, typecheck) and record the result as evidence on the active task. Use before saying work is ready. Optional commands override the checks in the project's central po-shell config.",
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
        return { ...text(`po-shell error: ${(error as Error).message}`), isError: true };
      }
    },
  });

  pi.registerTool({
    name: "po_shell_review",
    label: "po-shell review",
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
              meta.overLimit ? `aviso: supera maxChangedLines (${meta.limit})` : "",
              `diff: ${path.join(poShellPath(ctx.cwd), "reviews", meta.id, "diff.patch")}`,
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
        return { ...text(`po-shell error: ${(error as Error).message}`), isError: true };
      }
    },
  });

  pi.registerTool({
    name: "po_shell_ask",
    label: "po-shell ask",
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

  const subagentGuard = path.join(PACKAGE_ROOT, "extensions", "po-shell-subagent.ts");
  const subagentPrompt = path.join(PACKAGE_ROOT, "prompts", "po-shell-subagent.md");
  const rolePrompts: Record<string, string> = {
    explorer: path.join(PACKAGE_ROOT, "prompts", "subagents", "explore.md"),
    planner: path.join(PACKAGE_ROOT, "prompts", "subagents", "planner.md"),
    worker: path.join(PACKAGE_ROOT, "prompts", "subagents", "worker.md"),
    reviewer: path.join(PACKAGE_ROOT, "prompts", "subagents", "reviewer.md"),
  };

  pi.registerTool({
    name: "po_shell_delegate",
    label: "po-shell delegate",
    description:
      "Run one bounded subagent in a separate Pi process with a fresh, isolated context. The child gets a common protocol plus a short role contract, the allowed tools, a model for its role, and no access to po-shell memory, tasks or central state. A worker must declare `surfaces` (repo-relative paths or globs) and the child guard refuses writes outside them; a markdown or central-state write is refused for every role. Exploration of an area you do not know is delegation, not a few greps. Supports token/turn budgets, a renewable silence budget, a capped report (full text stays in the artifact) and audit artifacts under the central po-shell state directory. Returns the child's final text; the parent must verify it, not trust it.",
    parameters: Type.Object({
      role: Type.Union([
        Type.Literal("explorer"),
        Type.Literal("planner"),
        Type.Literal("worker"),
        Type.Literal("reviewer"),
      ]),
      task: Type.String(),
      surfaces: Type.Optional(Type.Array(Type.String())),
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
      const surfaces = (params.surfaces ?? []).map((value: string) => String(value).trim()).filter(Boolean);
      if (params.role === "worker" && surfaces.length === 0) {
        return {
          ...text(
            "po_shell_delegate: un worker necesita `surfaces` (paths o globs repo-relativos). Sin superficies declaradas no hay límite de escritura y el kernel no lo acepta.",
          ),
          isError: true,
        };
      }
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
        `MISSION (role: ${params.role}):`,
        params.task,
        surfaces.length ? `\nEDIT SURFACES (the only paths you may write):\n${surfaces.map((s: string) => `- ${s}`).join("\n")}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      const args = buildSubagentArgs({
        guardPath: subagentGuard,
        promptPath: subagentPrompt,
        rolePath: rolePrompts[params.role],
        tools,
        model,
        mission: prompt,
      });
      const timeoutMs = Math.max(10, Math.min(3600, params.timeout_seconds ?? 300)) * 1000;
      const started = Date.now();
      let childScratch: any = null;
      const childId = trackChild(params.role);
      startPanelTicker(ctx);
      applyPanel(ctx);
      try {
        try {
          childScratch = createSubagentScratch(process.env);
        } catch {
          // Sin scratch propio el hijo hereda el temp de la sesión.
        }
        const result = await runPiJson(ctx.cwd, args, {
          signal: _signal,
          maxTokens: params.max_tokens,
          maxTurns: params.max_turns,
          timeoutMs,
          tmpDir: childScratch?.dir,
          surfaces,
        });
        const output = result.text.trim() || result.stderr.trim() || "(sin salida)";
        const runId = `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        const usage = result.totalUsage ?? result.usage ?? {};
        const total = usageTotal(usage);
        const costModel = model ?? (ctx.model as any)?.id ?? (ctx.model as any)?.name ?? "unknown";
        // Cost first, artifact second: the artifact meta carries the credits, and
        // computing them afterwards once hid a TDZ error inside a silent catch.
        let subagentCost: any = null;
        if (isInitialized(ctx.cwd)) {
          try {
            const task = attributableTask(ctx.cwd);
            subagentCost = recordCost(ctx.cwd, {
              usage,
              model: costModel,
              role: params.role,
              source: "subagent",
              sessionId: sessionIdOf(ctx),
              taskId: task?.id ?? null,
              taskTitle: task?.title ?? null,
            });
            addSessionCredits(subagentCost);
          } catch {
            // El ledger no debe romper la delegación.
          }
        }
        let artifact = null;
        let artifactError: string | null = null;
        if (isInitialized(ctx.cwd)) {
          try {
            artifact = saveAgentArtifact(ctx.cwd, {
              id: runId,
              output,
              events: result.events,
              meta: delegationMeta({
                role: params.role,
                task: params.task,
                model,
                tools,
                surfaces,
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
              }),
            });
          } catch (error) {
            // La auditoría no tumba la delegación, pero tampoco se esconde.
            artifactError = (error as Error).message;
          }
        }
        const config = (() => {
          try {
            return loadConfig(ctx.cwd);
          } catch {
            return null;
          }
        })();
        const capped = capReport(output, {
          maxBytes: Number(config?.reportMaxBytes) || undefined,
          artifactPath: artifact?.resultPath,
        });
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
              `budget: max_tokens=${params.max_tokens ?? 0} (output acumulado) max_turns=${params.max_turns ?? 0}`,
              `output: ${result.outputTokens ?? 0} tokens`,
              capped.truncated ? `report: ${capped.deliveredBytes} of ${capped.bytes} bytes (full text in the artifact)` : "",
              `artifact: ${artifact ? artifact.resultPath : artifactError ? `fallo (${artifactError})` : "(no guardado)"}`,
              "",
              capped.text,
            ].join("\n"),
          ),
          isError: result.status !== "ok",
        };
      } catch (error) {
        return { ...text(`po-shell delegate error: ${(error as Error).message}`), isError: true };
      } finally {
        liveChildren.delete(childId);
        if (childScratch) childScratch.cleanup();
        applyPanel(ctx);
      }
    },
  });

  pi.on("tool_call", async (event, ctx) => {
    if (!isInitialized(ctx.cwd)) return undefined;
    try {
      const verdict = checkPolicy(ctx.cwd, event.toolName, event.input ?? {});
      if (verdict.block) return { block: true, reason: verdict.reason };
      if (verdict.confirm) {
        const allowed = await confirmDestructive(ctx, verdict, event.input ?? {});
        if (!allowed) {
          return {
            block: true,
            reason:
              `po-shell policy: ${verdict.key} sin confirmación. ` +
              "Sin UI se niega por defecto: el humano lo corre a mano o cambia el guard en config.",
          };
        }
      }
      const task = activeTask(ctx.cwd);
      if (task?.risk === "high" && task.planApproved !== true) {
        const writesFile = event.toolName === "edit" || event.toolName === "write";
        const writesShell =
          event.toolName === "bash" && mutatingCommand(event.input?.command);
        if (writesFile || writesShell) {
          return {
            block: true,
            reason:
              "High-risk task requires plan approval. Show the plan and call po_shell_task with action=approve before editing.",
          };
        }
      }
      return undefined;
    } catch (error) {
      // Fail closed: if the policy cannot be evaluated, do not run the tool.
      return { block: true, reason: `po-shell policy error: ${(error as Error).message}` };
    }
  });

  pi.on("message_end", async (event, ctx) => {
    const message = event.message as any;
    if (!isInitialized(ctx.cwd)) return;
    if (message?.role !== "assistant" || !message.usage) return;
    try {
      const task = attributableTask(ctx.cwd);
      const recorded = recordCost(ctx.cwd, {
        usage: message.usage,
        model: (ctx.model as any)?.id ?? (ctx.model as any)?.name ?? "unknown",
        role: "orchestrator",
        source: "chat",
        sessionId: sessionIdOf(ctx),
        taskId: task?.id ?? null,
        taskTitle: task?.title ?? null,
      });
      addSessionCredits(recorded);
      // Context pressure is measured from the prompt the provider just saw, and
      // the window comes from the active model: a hardcoded size would lie for
      // every model with a different one.
      const window =
        Number((ctx.model as any)?.contextWindow) || Number(loadConfig(ctx.cwd)?.contextWindow) || 0;
      const tokens = messagePromptTokens(message.usage);
      if (window > 0 && tokens > 0) saveContextPressure(ctx.cwd, { tokens, window });
    } catch {
      // El ledger no debe romper el loop del agente.
    }
  });

  pi.on("session_before_compact", async (event, ctx) => {
    try {
      const task = activeTask(ctx.cwd);
      const lines = [
        "<po_shell_checkpoint>",
        `reason: ${event.reason}`,
        `created: ${new Date().toISOString()}`,
        task
          ? `task: ${task.id} · ${task.phase} · risk ${task.risk} · ${task.title}`
          : "task: none",
        task?.next ? `next: ${task.next}` : "",
        task?.scope ? `scope: ${task.scope}` : "",
        task?.outOfScope ? `out_of_scope: ${task.outOfScope}` : "",
        task ? `evidence: ${(task.evidence ?? []).length}` : "",
        "</po_shell_checkpoint>",
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
          "<po_shell_directives>",
          ...directives.map(
            (item: any) =>
              `- [${item.scope}, ${item.priority}] ${item.rule}${item.trigger ? ` (cuando: ${item.trigger})` : ""}`,
          ),
          "</po_shell_directives>",
        ].join("\n")
      : "";
    const parts = [content, directiveBlock, pendingCheckpoint].filter(Boolean);
    pendingCheckpoint = "";
    if (!parts.length) return undefined;
    return {
      message: {
        customType: "po-shell-context",
        content: parts.join("\n\n"),
        display: false,
      },
    };
  });
}
