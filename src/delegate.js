import { spawn } from "node:child_process";

export function addUsage(total, usage) {
  if (!usage) return total;
  total.input += Number(usage.input) || 0;
  total.output += Number(usage.output) || 0;
  total.cacheRead += Number(usage.cacheRead) || 0;
  total.cacheWrite += Number(usage.cacheWrite) || 0;
  return total;
}

function emptyUsage() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}

export function usageTotal(usage) {
  if (!usage) return 0;
  if (Number.isFinite(usage.totalTokens)) return usage.totalTokens;
  return (
    (usage.input ?? 0) +
    (usage.output ?? 0) +
    (usage.cacheRead ?? 0) +
    (usage.cacheWrite ?? 0)
  );
}

function assistantText(message) {
  if (!message || message.role !== "assistant" || !Array.isArray(message.content)) return "";
  return message.content
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

export function buildSubagentArgs({ guardPath, promptPath, rolePath, tools, model, mission }) {
  const args = [
    "--mode",
    "json",
    "--no-session",
    "--no-extensions",
    "--extension",
    guardPath,
    "--no-skills",
    "--no-prompt-templates",
    "--no-mcp",
    "--no-context-files",
    "--append-system-prompt",
    promptPath,
  ];
  // The role contract is a second, short prompt: one contract per role beats
  // one long prompt for every child.
  if (rolePath) args.push("--append-system-prompt", rolePath);
  args.push("--tools", tools.join(","));
  if (model) args.push("--model", model);
  args.push(mission);
  return args;
}

/* ------------------------------ report cap ------------------------------ */

export const DEFAULT_REPORT_MAX_BYTES = 16_384;
const REPORT_TAIL_BYTES = 2_048;
const LINE_WINDOW_BYTES = 512;

/** Cut `text` at a byte budget without splitting a character; prefer a line break. */
function cutAt(text, budget) {
  if (budget <= 0) return "";
  let body = Buffer.from(text, "utf8").subarray(0, budget).toString("utf8");
  if (body.includes("\uFFFD")) body = body.slice(0, body.lastIndexOf("\uFFFD"));
  const lastBreak = body.lastIndexOf("\n");
  if (lastBreak > 0 && body.length - lastBreak <= LINE_WINDOW_BYTES) body = body.slice(0, lastBreak);
  return body;
}

function tailAt(text, budget) {
  if (budget <= 0) return "";
  const bytes = Buffer.from(text, "utf8");
  let body = bytes.subarray(Math.max(0, bytes.length - budget)).toString("utf8");
  const fffd = body.indexOf("\uFFFD");
  if (fffd >= 0) body = body.slice(fffd + 1);
  const firstBreak = body.indexOf("\n");
  if (firstBreak >= 0 && firstBreak <= LINE_WINDOW_BYTES) body = body.slice(firstBreak + 1);
  return body;
}

function looksLikeJson(text) {
  const trimmed = text.trim();
  if (!trimmed || !["{", "["].includes(trimmed[0])) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

/**
 * Bound the copy of a child report that enters the parent's context.
 * The stored artifact keeps every byte; this only decides what is delivered.
 * A JSON report is never cut, and a report that fits is delivered unchanged.
 */
export function capReport(text, { maxBytes = DEFAULT_REPORT_MAX_BYTES, artifactPath } = {}) {
  const value = String(text ?? "");
  const bytes = Buffer.byteLength(value, "utf8");
  if (!value || bytes <= maxBytes || looksLikeJson(value)) {
    return { text: value, truncated: false, bytes, deliveredBytes: bytes };
  }
  const tailBudget = Math.min(REPORT_TAIL_BYTES, Math.floor(maxBytes / 4));
  const head = cutAt(value, maxBytes - tailBudget);
  const tail = tailAt(value, tailBudget);
  const pointer = [
    "",
    `[po-shell] report truncated: ${Buffer.byteLength(head, "utf8") + Buffer.byteLength(tail, "utf8")} of ${bytes} bytes delivered.`,
    artifactPath ? `Full text: ${artifactPath}` : "Full text: ask the parent for the artifact path.",
    "",
  ].join("\n");
  const capped = `${head}${pointer}${tail}`;
  return {
    text: capped,
    truncated: true,
    bytes,
    deliveredBytes: Buffer.byteLength(capped, "utf8"),
  };
}

/**
 * Metadata for a delegation artifact. Every input is an argument on purpose: an
 * earlier version referenced a variable declared further down, threw a TDZ
 * ReferenceError inside a silent catch, and no artifact was ever written.
 */
export function delegationMeta({
  role,
  task,
  model,
  tools,
  surfaces,
  status,
  exitCode,
  ms,
  usage,
  totalUsage,
  totalTokens,
  credits,
  turns,
  maxTokens,
  maxTurns,
  timeoutSeconds,
} = {}) {
  return {
    role: role ?? null,
    task: String(task ?? "").slice(0, 4000),
    model: model ?? null,
    tools: Array.isArray(tools) ? [...tools] : [],
    surfaces: Array.isArray(surfaces) ? [...surfaces] : [],
    status: status ?? null,
    exitCode: exitCode ?? null,
    ms: Number(ms) || 0,
    usage: usage ?? null,
    totalUsage: totalUsage ?? null,
    totalTokens: Number(totalTokens) || 0,
    credits: credits ?? null,
    turns: Number(turns) || 0,
    maxTokens: maxTokens ?? null,
    maxTurns: maxTurns ?? null,
    timeoutSeconds: timeoutSeconds ?? null,
  };
}

export function runPiJson(cwd, args, options = {}) {
  const env = options.env ?? process.env;
  const maxTokens = Number(options.maxTokens) || 0;
  const maxTurns = Number(options.maxTurns) || 0;
  const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 300_000);
  const signal = options.signal;

  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({
        code: null,
        text: "",
        stderr: "",
        events: [],
        usage: {},
        totalUsage: emptyUsage(),
        turns: 0,
        status: "aborted",
        budgetExceeded: false,
        turnsExceeded: false,
        timedOut: false,
      });
      return;
    }

    const childEnv = { ...env, PO_SHELL_SUBAGENT: "1" };
    if (Array.isArray(options.surfaces) && options.surfaces.length) {
      childEnv.PO_SHELL_SUBAGENT_SURFACES = options.surfaces.join(",");
    }
    if (options.role) childEnv.PO_SHELL_SUBAGENT_ROLE = String(options.role);
    if (Array.isArray(options.readOutside) && options.readOutside.length) {
      childEnv.PO_SHELL_SUBAGENT_READ_OUTSIDE = options.readOutside.join(",");
    }
    if (options.tmpDir) {
      childEnv.TMPDIR = options.tmpDir;
      if (process.platform === "win32") {
        childEnv.TMP = options.tmpDir;
        childEnv.TEMP = options.tmpDir;
      }
    }
    const child = spawn(env.PO_SHELL_PI_BIN || "pi", args, {
      cwd,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let buffer = "";
    let stderr = "";
    let events = [];
    let usage = {};
    let totalUsage = emptyUsage();
    let turns = 0;
    let text = "";
    let liveText = "";
    let lastLiveText = "";
    let exitCode = null;
    let budgetExceeded = false;
    // Spend is completed output. Counting input or cache here killed children
    // whose cached prefix alone exceeded the budget on turn one.
    let outputSpent = 0;
    let turnsExceeded = false;
    let timedOut = false;
    let aborted = false;
    let settled = false;
    let forceTimer = null;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      if (forceTimer) clearTimeout(forceTimer);
      signal?.removeEventListener("abort", onAbort);
      const status = timedOut
        ? "timeout"
        : budgetExceeded
          ? "budget_exceeded"
          : turnsExceeded
            ? "turns_exceeded"
            : aborted
              ? "aborted"
              : exitCode === 0
                ? "ok"
                : "error";
      resolve({
        code: exitCode,
        text: text || lastLiveText || liveText,
        stderr,
        events,
        usage,
        totalUsage,
        outputTokens: outputSpent,
        turns,
        status,
        budgetExceeded,
        turnsExceeded,
        timedOut,
      });
    };

    const kill = () => {
      if (child.killed) return;
      child.kill("SIGTERM");
      forceTimer = setTimeout(() => child.kill("SIGKILL"), 2000);
      forceTimer.unref?.();
    };

    const onAbort = () => {
      aborted = true;
      kill();
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeoutMs);
    timeoutTimer.unref?.();

    const handleLine = (line) => {
      const raw = line.replace(/\r$/, "").trim();
      if (!raw) return;
      let event;
      try {
        event = JSON.parse(raw);
      } catch {
        return;
      }
      if (events.length < 5000) events.push(event);

      if (event.type === "message_start") {
        liveText = "";
      }

      if (event.type === "message_update") {
        // Partial usage is not spend: only a finished message counts.
        if (event.usage) usage = event.usage;
        const update = event.assistantMessageEvent;
        if (update?.type === "text_delta" && typeof update.delta === "string") {
          liveText += update.delta;
        } else if (update?.type === "text_end" && typeof update.content === "string") {
          liveText = update.content;
        }
      }

      if (event.type === "message_end" && event.message) {
        if (event.message.usage) {
          usage = event.message.usage;
          addUsage(totalUsage, usage);
          outputSpent += Number(usage.output) || 0;
          if (maxTokens && outputSpent > maxTokens) {
            budgetExceeded = true;
            kill();
          }
        }
        const messageText = assistantText(event.message);
        if (messageText) text = messageText;
        liveText = "";
      }

      if (event.type === "turn_end") {
        turns += 1;
        if (liveText) {
          lastLiveText = liveText;
          liveText = "";
        }
        if (maxTurns && turns >= maxTurns) {
          turnsExceeded = true;
          kill();
        }
      }

      if (event.type === "agent_end" && !text && Array.isArray(event.messages)) {
        for (let i = event.messages.length - 1; i >= 0; i -= 1) {
          const messageText = assistantText(event.messages[i]);
          if (messageText) {
            text = messageText;
            break;
          }
        }
      }
    };

    child.stdout?.on("data", (chunk) => {
      buffer += String(chunk);
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        handleLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
    });

    child.stderr?.on("data", (chunk) => {
      const next = String(chunk);
      if (stderr.length < 40_000) stderr += next.slice(0, 40_000 - stderr.length);
    });

    child.on("error", (error) => {
      stderr += `${stderr ? "\n" : ""}${error.message}`;
      exitCode = 1;
      finish();
    });

    child.on("close", (code, signal) => {
      if (buffer.trim()) handleLine(buffer);
      exitCode = code ?? (signal ? 1 : 0);
      finish();
    });
  });
}
