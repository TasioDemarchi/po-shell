import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { applyChecks, suggestChecks } from "./checks.js";
import { costSummary, formatCredits } from "./costs.js";
import { formatCommand, installMethod, installReport, renderInstallReport, uninstallPlan, updatePlan } from "./install.js";
import { checkIntegrity, createBackup, fixIntegrity, listBackups, restoreBackup } from "./backup.js";
import { directorySize, formatSize, listScratch, sweepScratch } from "./scratch.js";
import { activeDirectives, getContext, searchContext } from "./context.js";
import { indexProject } from "./indexer.js";
import { listProjectStates, poShellHome, projectInfo, pruneProjectStates } from "./project.js";
import {
  PHASES,
  RISKS,
  activeTask,
  appendEvent,
  checkPolicy,
  createTask,
  events,
  freezeReview,
  getTask,
  init,
  isInitialized,
  listTasks,
  loadConfig,
  memoryIndex,
  poShellPath,
  renderStatus,
  reviewDiff,
  runChecks,
  saveMemory,
  status,
  updateTask,
} from "../src/kernel.js";

function parseOptions(args) {
  const options = {};
  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--") {
      positional.push(...args.slice(i + 1));
      break;
    }
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next === undefined || next.startsWith("--")) {
        options[key] = true;
      } else {
        options[key] = next;
        i += 1;
      }
    } else {
      positional.push(arg);
    }
  }
  return { options, positional };
}

function fail(message) {
  console.error(`po-shell: ${message}`);
  process.exit(1);
}

function requireInit(cwd) {
  if (!isInitialized(cwd)) fail("no inicializado. Corré: po-shell init");
}

function printTask(task) {
  if (!task) return console.log("(sin tarea)");
  console.log(`${task.id} · ${task.phase} · riesgo ${task.risk}`);
  console.log(`  ${task.title}`);
  if (task.scope) console.log(`  scope: ${task.scope}`);
  if (task.outOfScope) console.log(`  out: ${task.outOfScope}`);
  if (task.next) console.log(`  next: ${task.next}`);
  console.log(`  evidencia: ${(task.evidence ?? []).length}`);
}

function help() {
  console.log(`po-shell — arnés determinista para agentes

Uso:
  po-shell                     inicia el agente (Pi) con po-shell cargado
  po-shell doctor              chequea Node, Pi, git y archivos
  po-shell install [--json]    verifica la instalación (no instala nada)
  po-shell update [--yes] [--json]     muestra o ejecuta la actualización
  po-shell uninstall [--yes] [--json]  desinstala el paquete, nunca tu estado
  po-shell shell [args...]     inicia el agente con argumentos para Pi
  po-shell init
  po-shell where [--json]
  po-shell projects [--all] [--json]
  po-shell projects prune [--dry-run] [--yes] [--json]
  po-shell checks suggest [--write] [--json]
  po-shell status [--json]
  po-shell task new "<título>" [--risk low|medium|high] [--scope "..."] [--out "..."]
  po-shell task phase <${PHASES.join("|")}> [id]
  po-shell task list
  po-shell task show [id]
  po-shell remember "<regla>" [--title "..."] [--trigger "..."] [--aliases "a, b"] [--priority low|medium|high] [--scope project|global]
  po-shell directives [--json]
  po-shell memory save --title "..." --what "..." [--why "..."] [--where "..."] [--learned "..."] [--topic "..."] [--type "..."] [--scope "..."] [--priority "..."] [--trigger "..."] [--aliases "a, b"] [--status "..."]
  po-shell memory search "<query>"
  po-shell memory index
  po-shell check [-- <comando>...]
  po-shell review freeze [--base HEAD]
  po-shell review show [id] [--diff]
  po-shell policy test --tool bash --command "rm -rf /"
  po-shell policy test --tool write --path .env
  po-shell events [n]
  po-shell costs [--project <id>|--all-projects] [--task <id>] [--model <id>] [--days N] [--json]
  po-shell backup [--output <dir>] [--json]
  po-shell backup list [--all] [--json]
  po-shell restore <backup-dir> --yes [--no-db] [--global] [--json]
  po-shell integrity [--fix] [--json]
  po-shell scratch [list|clean] [--force] [--json]
  po-shell index [--rebuild] [--json]
  po-shell context search "<query>" [--kind spec|memory] [--type <tipo>] [--limit N] [--all-projects] [--json]
  po-shell context get "<spec:path#ordinal|mem:key>" [--json]

Estado central (por proyecto):
  ~/.po-shell/projects/<id>/config.json      política y checks
  ~/.po-shell/projects/<id>/tasks/*.json     estado de tareas
  ~/.po-shell/projects/<id>/memory/*.md      memoria durable
  ~/.po-shell/projects/<id>/reviews/*        candidatos congelados
  ~/.po-shell/projects/<id>/events.jsonl     log de eventos

Los docs del proyecto (.md) siguen viviendo en el repo.`);
}

export async function main(argv = process.argv.slice(2), cwd = process.cwd()) {
  const json = argv.includes("--json");
  const clean = argv.filter((arg) => arg !== "--json");
  const [command, ...rest] = clean;

  if (!command || command === "help" || command === "--help") return help();

  if (command === "where") {
    const info = projectInfo(cwd, process.env);
    if (json) return console.log(JSON.stringify(info, null, 2));
    console.log(`Proyecto: ${info.name}`);
    console.log(`  id: ${info.id}`);
    console.log(`  root: ${info.root}`);
    console.log(`  estado: ${info.stateDir}`);
    console.log(`  contexto: ${info.contextDb}`);
    console.log(`  inicializado: ${info.initialized ? "sí" : "no"}`);
    return;
  }

  if (command === "projects") {
    const { options, positional } = parseOptions(rest);
    if (positional[0] === "prune") {
      const result = pruneProjectStates(process.env, { dryRun: !options.yes });
      if (json) return console.log(JSON.stringify(result, null, 2));
      if (!result.candidates.length) return console.log("(sin estados huérfanos)");
      for (const item of result.candidates) {
        const reason = !item.hasMetadata || !item.root ? "sin metadata" : "root inexistente";
        console.log(`  ${item.id}  ${item.name}  ${item.root ?? "(sin root)"}  [${reason}]`);
      }
      if (result.moved.length) {
        console.log(`Movidos a backup: ${result.moved.length}`);
        console.log(`  ${result.trashDir}`);
      } else {
        console.log(`Candidatos: ${result.candidates.length}`);
        console.log("No se movió nada. Para moverlos a backup: po-shell projects prune --yes");
      }
      return;
    }
    const projects = listProjectStates(process.env, { all: Boolean(options.all) });
    if (json) return console.log(JSON.stringify(projects, null, 2));
    if (!projects.length) return console.log("(sin proyectos)");
    const width = Math.max(10, ...projects.map((item) => item.id.length));
    console.log(`${"ID".padEnd(width)}  ${"PROYECTO".padEnd(24)}  ROOT`);
    for (const item of projects) {
      console.log(
        `${item.id.padEnd(width)}  ${String(item.name).padEnd(24)}  ${item.root ?? "(sin root)"}`,
      );
    }
    return;
  }

  if (command === "install") {
    const report = installReport({ cwd });
    if (json) return console.log(JSON.stringify(report, null, 2));
    const code = renderInstallReport(report);
    if (code !== 0) process.exitCode = code;
    return;
  }

  if (command === "update" || command === "uninstall") {
    const { options } = parseOptions(rest);
    const detected = installMethod();
    const plan = command === "update" ? updatePlan(detected.method) : uninstallPlan(detected.method);
    const payload = { action: command, method: detected.method, bin: detected.bin, plan, executed: false };

    if (!plan) {
      if (json) return console.log(JSON.stringify({ ...payload, executed: false }, null, 2));
      console.log("No encontré una instalación global de po-shell.");
      console.log(`El estado central queda intacto: ${poShellHome(process.env)}`);
      return;
    }

    if (!json) {
      console.log(`método de instalación: ${detected.method}${detected.bin ? ` (${detected.bin})` : ""}`);
      console.log(`comando: ${formatCommand(plan)}${plan.cwd ? `  (en ${plan.cwd})` : ""}`);
      if (command === "update" && detected.method === "link") {
        console.log("antes actualizá el checkout: git pull --ff-only");
      }
      if (command === "uninstall") {
        console.log(`el estado central NO se toca: ${poShellHome(process.env)}`);
      }
    }

    if (!options.yes) {
      if (json) return console.log(JSON.stringify(payload, null, 2));
      console.log(`No se ejecutó nada. Para ejecutarlo: po-shell ${command} --yes`);
      return;
    }

    const result = spawnSync(plan.command, plan.args, {
      stdio: json ? "pipe" : "inherit",
      cwd: plan.cwd,
      encoding: "utf8",
      env: process.env,
    });
    const status = result.status ?? 1;
    if (json) {
      console.log(
        JSON.stringify(
          { ...payload, executed: true, status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" },
          null,
          2,
        ),
      );
    }
    if (status !== 0) process.exitCode = status;
    return;
  }

  if (command === "init") {
    const result = init(cwd);
    console.log(`po-shell inicializado en ${result.root}`);
    if (result.migratedFrom) console.log(`Estado migrado desde ${result.migratedFrom}`);
    return;
  }

  if (command === "status") {
    if (json) return console.log(JSON.stringify(status(cwd, { cost: true }), null, 2));
    return console.log(renderStatus(cwd));
  }

  if (command === "events") {
    const n = Number(rest[0] ?? 20) || 20;
    for (const event of events(cwd, n)) {
      console.log(`${event.ts}  ${event.type}  ${JSON.stringify(event.data)}`);
    }
    return;
  }

  if (command === "task") {
    const [action, ...args] = rest;
    const { options, positional } = parseOptions(args);

    if (action === "new") {
      const title = positional.join(" ").trim();
      if (!title) fail('falta el título: po-shell task new "mi feature"');
      const acceptance = options.acceptance
        ? String(options.acceptance)
            .split("|")
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
      const task = createTask(cwd, {
        title,
        risk: options.risk ?? "medium",
        scope: options.scope ?? "",
        outOfScope: options.out ?? "",
        acceptance,
      });
      console.log(`Tarea creada: ${task.id}`);
      printTask(task);
      return;
    }

    if (action === "phase") {
      const phase = positional[0];
      const id = positional[1];
      if (!phase) fail(`falta la fase. Opciones: ${PHASES.join(", ")}`);
      const task = updateTask(cwd, id, { phase });
      console.log(`Tarea ${task.id} → ${task.phase}`);
      return;
    }

    if (action === "list") {
      const tasks = listTasks(cwd);
      if (json) return console.log(JSON.stringify(tasks, null, 2));
      if (!tasks.length) return console.log("(sin tareas)");
      for (const task of tasks) {
        const active = activeTask(cwd)?.id === task.id ? "*" : " ";
        console.log(`${active} ${task.id}  ${task.phase.padEnd(12)} ${task.risk.padEnd(6)} ${task.title}`);
      }
      return;
    }

    if (action === "show") {
      const task = positional[0] ? getTask(cwd, positional[0]) : activeTask(cwd);
      if (json) return console.log(JSON.stringify(task, null, 2));
      return printTask(task);
    }

    if (action === "update") {
      const id = positional[0];
      const patch = {};
      if (options.phase) patch.phase = options.phase;
      if (options.risk) patch.risk = options.risk;
      if (options.next) patch.next = options.next;
      if (options.scope) patch.scope = options.scope;
      const task = updateTask(cwd, id, patch);
      printTask(task);
      return;
    }

    return fail("acción de task desconocida");
  }

  if (command === "directives") {
    const directives = activeDirectives(cwd);
    if (json) return console.log(JSON.stringify(directives, null, 2));
    if (!directives.length) return console.log("(sin directivas activas)");
    for (const item of directives) {
      const trigger = item.trigger ? ` (cuando: ${item.trigger})` : "";
      console.log(`[${item.scope}, ${item.priority}] ${item.rule}${trigger}`);
    }
    return;
  }

  if (command === "checks") {
    const [action, ...args] = rest;
    if (action !== "suggest") return fail("uso: po-shell checks suggest [--write] [--json]");
    const { options } = parseOptions(args);
    const result = suggestChecks(cwd);
    if (json) {
      console.log(JSON.stringify(result, null, 2));
    } else if (!result.commands.length) {
      console.log("(no pude detectar checks)");
    } else {
      console.log("Sugerencias:");
      for (const command of result.commands) console.log(`  ${command}`);
      console.log("");
      if (!options.write) console.log("No se escribió nada. Para aplicarlas: po-shell checks suggest --write");
    }
    if (options.write) {
      if (!result.commands.length) return;
      const checks = applyChecks(cwd, result.commands);
      if (!json) console.log(`Checks guardados: ${checks.join(" | ")}`);
    }
    return;
  }

  if (command === "remember") {
    const { options, positional } = parseOptions(rest);
    const rule = positional.join(" ").trim();
    if (!rule) fail('falta la regla: po-shell remember "Antes de refactorizar, mostrar plan"');
    const scope = options.scope ?? "project";
    const priority = options.priority ?? "medium";
    if (!["project", "global"].includes(scope)) fail("scope inválido: project|global");
    if (!["low", "medium", "high"].includes(priority)) fail("priority inválida: low|medium|high");
    const title = options.title ?? rule.slice(0, 80);
    const result = saveMemory(cwd, {
      title,
      what: rule,
      why: options.why ?? "Pedido explícito del humano.",
      where: options.where ?? "",
      learned: options.learned ?? "",
      topic: options.topic ?? "",
      type: "behavior",
      scope,
      priority,
      trigger: options.trigger ?? "",
      aliases: options.aliases ?? "",
      status: "active",
    });
    indexProject(cwd);
    if (json) return console.log(JSON.stringify({ ...result, scope, priority, type: "behavior" }, null, 2));
    console.log(`Directiva: ${result.slug}`);
    console.log(`  scope: ${scope} · priority: ${priority}`);
    if (options.trigger) console.log(`  trigger: ${options.trigger}`);
    return;
  }

  if (command === "memory") {
    const [action, ...args] = rest;
    const { options, positional } = parseOptions(args);

    if (action === "save") {
      const result = saveMemory(cwd, {
        title: options.title,
        what: options.what,
        why: options.why ?? "",
        where: options.where ?? "",
        learned: options.learned ?? "",
        topic: options.topic ?? "",
        type: options.type ?? "",
        scope: options.scope ?? "",
        priority: options.priority ?? "",
        trigger: options.trigger ?? "",
        aliases: options.aliases ?? "",
        status: options.status ?? "",
      });
      console.log(`Memoria: ${result.slug}`);
      return;
    }

    if (action === "search") {
      const query = positional.join(" ");
      const result = await searchContext(cwd, query, { kinds: ["memory"], limit: 5 });
      if (json) return console.log(JSON.stringify(result, null, 2));
      if (!result.results.length) {
        if (result.globalBlocked) {
          return console.log("WARN memoria global: confirmá con el usuario antes de usarla.");
        }
        return console.log("(sin resultados)");
      }
      if (result.requiresConfirmation) {
        console.log("WARN memoria global: confirmá con el usuario antes de usarla.");
      }
      for (const item of result.results) {
        console.log(`\n## ${item.id} · ${item.title}`);
        console.log(item.snippet);
      }
      return;
    }

    if (action === "index") {
      const index = memoryIndex(cwd);
      if (json) return console.log(JSON.stringify(index, null, 2));
      if (!index.length) return console.log("(sin memorias)");
      for (const entry of index) console.log(`${entry.slug}  ${entry.topic}  ${entry.title}`);
      return;
    }

    return fail("acción de memory desconocida");
  }

  if (command === "ask") {
    const { options, positional } = parseOptions(rest);
    const query = positional.join(" ").trim();
    if (!query) fail('falta la pregunta: po-shell ask "tema"');
    const result = await searchContext(cwd, query, {
      project: options.project,
      kinds: options.kind ? [options.kind] : undefined,
      type: options.type,
      limit: Number(options.limit) || 5,
      allProjects: Boolean(options["all-projects"]),
    });
    if (json) return console.log(JSON.stringify(result, null, 2));
    if (!result.results.length) return console.log("(sin resultados)");
    if (result.requiresConfirmation) {
      console.log("WARN memoria global: confirmá con el usuario antes de usarla.");
    }
    for (const item of result.results) {
      const label = item.kind === "spec" ? `spec:${item.path}#${item.ordinal}` : item.id;
      const title =
        item.kind === "spec"
          ? item.breadcrumb
          : `${item.project ?? "proyecto"} · ${item.type} · ${item.title}`;
      console.log(`[${item.kind}] ${label} · ${title}`);
      console.log(`  ${item.snippet.replace(/\s+/g, " ").trim()}`);
    }
    return;
  }

  if (command === "context") {
    const [action, ...args] = rest;
    const { options, positional } = parseOptions(args);

    if (action === "search") {
      const query = positional.join(" ").trim();
      if (!query) fail('falta la búsqueda: po-shell context search "tema"');
      const result = await searchContext(cwd, query, {
        project: options.project,
        kinds: options.kind ? [options.kind] : undefined,
        type: options.type,
        limit: Number(options.limit) || 5,
        allProjects: Boolean(options["all-projects"]),
      });
      if (json) return console.log(JSON.stringify(result, null, 2));
      if (!result.results.length) {
        if (result.globalBlocked) {
          return console.log("WARN memoria global: confirmá con el usuario antes de usarla.");
        }
        return console.log("(sin resultados)");
      }
      if (result.requiresConfirmation) {
        console.log("WARN memoria global: confirmá con el usuario antes de usarla.");
      }
      for (const item of result.results) {
        const label = item.kind === "spec" ? `spec:${item.path}#${item.ordinal}` : item.id;
        const title =
          item.kind === "spec"
            ? item.breadcrumb
            : `${item.project ?? "proyecto"} · ${item.type} · ${item.title}`;
        console.log(`[${item.kind}] ${label} · ${title}`);
        console.log(`  ${item.snippet.replace(/\s+/g, " ").trim()}`);
      }
      return;
    }

    if (action === "get") {
      const id = positional[0];
      if (!id) fail('falta la referencia: po-shell context get "spec:docs/x.md#2"');
      const item = getContext(cwd, id);
      if (json) return console.log(JSON.stringify(item, null, 2));
      const location =
        item.kind === "spec"
          ? `${item.path}#${item.ordinal} · ${item.breadcrumb} (L${item.lineStart}-L${item.lineEnd})`
          : `${item.id} · ${item.project ?? "proyecto"} · ${item.type} · ${item.title}`;
      console.log(location);
      console.log(item.content);
      return;
    }

    return fail("uso: po-shell context search|get ...");
  }

  if (command === "backup") {
    const { options, positional } = parseOptions(rest);
    if (positional[0] === "list") {
      const info = projectInfo(cwd);
      const backups = listBackups(process.env, options.all ? {} : { projectId: info.id });
      if (json) return console.log(JSON.stringify(backups, null, 2));
      if (!backups.length) return console.log("(sin backups)");
      for (const item of backups) {
        console.log(`${item.manifest.createdAt}  ${item.path}`);
      }
      return;
    }
    const result = createBackup(cwd, { output: options.output });
    if (json) return console.log(JSON.stringify(result, null, 2));
    console.log(`Backup: ${result.path}`);
    if (result.manifest.warnings.length) {
      for (const warning of result.manifest.warnings) console.log(`WARN: ${warning}`);
    }
    return;
  }

  if (command === "restore") {
    const { options, positional } = parseOptions(rest);
    const source = positional[0];
    if (!source) return fail("uso: po-shell restore <backup-dir> --yes");
    if (!options.yes) return fail("restore requiere --yes");
    const result = restoreBackup(cwd, source, {
      yes: true,
      db: options["no-db"] !== true,
      global: options.global === true,
    });
    if (json) return console.log(JSON.stringify(result, null, 2));
    console.log(`Restaurado en: ${result.restoredTo}`);
    console.log(`Estado anterior: ${result.trashDir}`);
    for (const warning of result.warnings) console.log(`WARN: ${warning}`);
    console.log("Verificá con: po-shell integrity");
    return;
  }

  if (command === "integrity") {
    const { options } = parseOptions(rest);
    const result = options.fix ? fixIntegrity(cwd) : checkIntegrity(cwd);
    const report = options.fix ? result.integrity : result;
    if (json) return console.log(JSON.stringify(result, null, 2));
    for (const check of report.checks) {
      if (check.ok) continue;
      console.log(`${check.level === "error" ? "ERROR" : "WARN "} ${check.name}: ${check.detail}`);
    }
    if (report.ok) {
      console.log(
        `Integridad OK · ${report.checks.length} checks · ${report.warnings} warnings`,
      );
    } else {
      console.log(`Integridad FALLÓ · ${report.errors} errores · ${report.warnings} warnings`);
      process.exitCode = 1;
    }
    return;
  }

  if (command === "scratch") {
    const { options, positional } = parseOptions(rest);
    const action = positional[0] ?? "list";
    if (action === "clean") {
      const result = sweepScratch(process.env, { graceMs: options.force ? 0 : undefined });
      if (json) return console.log(JSON.stringify(result, null, 2));
      console.log(`Scratch removidos: ${result.removed.length}`);
      for (const item of result.removed) console.log(`  ${item.ledger.scratchDir}`);
      if (result.kept.length) {
        console.log(`Conservados: ${result.kept.length}`);
        for (const item of result.kept) {
          console.log(`  ${item.ledger.scratchDir} · ${item.reason}`);
        }
      }
      if (result.refused.length) {
        console.log(`Rechazados: ${result.refused.length}`);
        for (const item of result.refused) {
          console.log(`  ${item.ledger.scratchDir} · ${item.reason}`);
        }
      }
      return;
    }
    if (action !== "list") return fail("uso: po-shell scratch [list|clean] [--force]");
    const records = listScratch(process.env);
    if (json) return console.log(JSON.stringify(records, null, 2));
    if (!records.length) return console.log("(sin scratch)");
    for (const item of records) {
      const size = item.valid && !item.live ? ` · ${formatSize(directorySize(item.ledger.scratchDir))}` : "";
      const status = item.live ? "live" : item.valid ? "ended" : "invalid";
      console.log(`${status.padEnd(7)} ${item.ledger.scratchDir}${size}`);
    }
    return;
  }

  if (command === "index") {
    const { options } = parseOptions(rest);
    if (path.resolve(cwd) === os.homedir()) {
      fail("no indexes el home completo. Corré po-shell index desde la raíz del proyecto o usá po-shell ask --project <nombre>.");
    }
    const result = indexProject(cwd, { rebuild: Boolean(options.rebuild) });
    if (json) return console.log(JSON.stringify(result, null, 2));
    const { docs, memories, project } = result;
    console.log(`Índice: ${result.dbPath}`);
    console.log(`Proyecto: ${project.name} (${project.id})`);
    console.log(
      `Docs: ${docs.files} archivos, ${docs.chunks} secciones ` +
        `(${docs.updatedFiles} actualizados, ${docs.unchangedFiles} sin cambios, ${docs.removedFiles} eliminados)`,
    );
    console.log(
      `Memorias: ${memories.total} (${memories.updated} actualizadas, ` +
        `${memories.unchanged} sin cambios, ${memories.removed} eliminadas)`,
    );
    console.log(
      `Globales: ${result.globalMemories?.total ?? 0} ` +
        `(${result.globalMemories?.updated ?? 0} actualizadas, ` +
        `${result.globalMemories?.unchanged ?? 0} sin cambios)`,
    );
    return;
  }

  if (command === "costs") {
    const { options } = parseOptions(rest);
    const projectId =
      typeof options.project === "string"
        ? options.project
        : options["all-projects"]
          ? undefined
          : projectInfo(cwd).id;
    const summary = costSummary({
      projectId,
      taskId: typeof options.task === "string" ? options.task : undefined,
      model: typeof options.model === "string" ? options.model : undefined,
      days: typeof options.days === "string" ? options.days : undefined,
    });
    if (json) return console.log(JSON.stringify(summary, null, 2));
    if (!summary.events) return console.log("(sin eventos de costo)");
    console.log(
      `Créditos del harness: ${formatCredits(summary.credits)} · ${summary.events} eventos`,
    );
    console.log(
      `(solo lo consumido por po-shell en ${projectId ? "este proyecto" : "todos los proyectos"}; no es el saldo de Nan)`,
    );
    console.log(
      `Tokens: input ${summary.tokens.input}, cache ${summary.tokens.cached}, ` +
        `output ${summary.tokens.output}, cache write ${summary.tokens.cacheWrite}`,
    );
    if (summary.unknownModels) {
      console.log(`WARN: ${summary.unknownModels} evento(s) con modelo sin tarifa; créditos en 0.`);
    }
    const show = (title, groups) => {
      if (!groups.length) return;
      console.log(`\n${title}`);
      for (const group of groups.slice(0, 8)) {
        console.log(`  ${formatCredits(group.credits).padStart(8)}  ${group.label} (${group.events})`);
      }
    };
    show("Por modelo", summary.byModel);
    show("Por tarea", summary.byTask);
    show("Por rol", summary.byRole);
    show("Por proyecto", summary.byProject);
    return;
  }

  if (command === "check") {
    requireInit(cwd);
    const { positional } = parseOptions(rest);
    const result = runChecks(cwd, positional.length ? positional : null);
    for (const item of result.results) {
      console.log(`${item.ok ? "✓" : "✗"} ${item.command}  (${item.ms}ms, exit ${item.exitCode})`);
      if (!item.ok) console.log(item.output);
    }
    process.exit(result.ok ? 0 : 1);
  }

  if (command === "review") {
    const [action, ...args] = rest;
    const { options, positional } = parseOptions(args);
    requireInit(cwd);

    if (action === "freeze") {
      const meta = freezeReview(cwd, { base: options.base ?? "HEAD" });
      console.log(
        `Review congelado: ${meta.id}\n  hash: ${meta.hash}\n  riesgo: ${meta.risk}\n  archivos: ${meta.files.length}\n  +${meta.added} / -${meta.deleted}\n  diff: ${path.join(poShellPath(cwd), "reviews", meta.id, "diff.patch")}`,
      );
      return;
    }

    if (action === "show") {
      const { meta, diff } = reviewDiff(cwd, positional[0]);
      console.log(JSON.stringify(meta, null, 2));
      if (options.diff) console.log(diff);
      return;
    }

    return fail("acción de review desconocida");
  }

  if (command === "policy") {
    const [action, ...args] = rest;
    if (action !== "test") return fail("uso: po-shell policy test --tool bash --command ...");
    const { options } = parseOptions(args);
    const toolName = options.tool ?? "bash";
    const input =
      toolName === "bash"
        ? { command: options.command ?? "" }
        : { path: options.path ?? "" };
    const result = checkPolicy(cwd, toolName, input);
    if (json) return console.log(JSON.stringify(result, null, 2));
    console.log(result.block ? `BLOQUEADO: ${result.reason}` : "PERMITIDO");
    process.exit(result.block ? 2 : 0);
  }

  if (command === "config") {
    if (json) return console.log(JSON.stringify(loadConfig(cwd), null, 2));
    console.log(JSON.stringify(loadConfig(cwd), null, 2));
    return;
  }

  return fail(`comando desconocido: ${command}. Probá: po-shell help`);
}
