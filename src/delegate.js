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

export function buildSubagentArgs({ guardPath, promptPath, tools, model, mission }) {
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
    "--tools",
    tools.join(","),
  ];
  if (model) args.push("--model", model);
  args.push(mission);
  return args;
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
        if (event.usage) {
          usage = event.usage;
          if (maxTokens && usageTotal(usage) > maxTokens) {
            budgetExceeded = true;
            kill();
          }
        }
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
          if (maxTokens && usageTotal(usage) > maxTokens) {
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
