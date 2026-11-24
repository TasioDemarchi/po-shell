import { testScratchViolation } from "./scratch-guard.js";

const isMarkdown = (value) => /\.md$/i.test(String(value ?? "").replace(/\\/g, "/"));
const isPoShellState = (value) => {
  const p = String(value ?? "").replace(/\\/g, "/");
  return p === ".po-shell" || p.startsWith(".po-shell/") || p.includes("/.po-shell/");
};

export function subagentToolBlock(toolName, input = {}, cwd = process.cwd()) {
  if (String(toolName).startsWith("po_shell_")) {
    return "Un subagente no puede usar tools de memoria, tareas, review ni estado de po-shell.";
  }

  const scratchViolation = testScratchViolation({ toolName, input, cwd });
  if (scratchViolation) return `Subagente: ${scratchViolation}`;

  const file = input.path ?? input.file_path ?? input.filename ?? input.file;
  if ((toolName === "write" || toolName === "edit") && file != null) {
    if (isMarkdown(file)) {
      return "Un subagente no puede escribir ni modificar archivos .md.";
    }
    if (isPoShellState(file)) {
      return "Un subagente no puede tocar el estado central.";
    }
  }

  if (toolName === "bash" && typeof input.command === "string") {
    const command = input.command;
    if (
      /(?:>>?|tee|sed\s+-i|perl\s+-pi)[^;&|]*\.md\b/i.test(command) ||
      /\b(?:rm|mv|cp)\b[^;&|]*\.md\b/i.test(command)
    ) {
      return "Un subagente no puede modificar archivos .md desde bash.";
    }
    if (/(?:>>?|tee|sed\s+-i|perl\s+-pi)[^;&|]*\.po-shell(?:\/|\b)/i.test(command)) {
      return "Un subagente no puede tocar el estado central desde bash.";
    }
  }

  return null;
}
