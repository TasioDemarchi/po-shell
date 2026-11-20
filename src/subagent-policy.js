const isMarkdown = (value) => /\.md$/i.test(String(value ?? "").replace(/\\/g, "/"));
const isPlainState = (value) => {
  const p = String(value ?? "").replace(/\\/g, "/");
  return p === ".plain" || p.startsWith(".plain/") || p.includes("/.plain/");
};

export function subagentToolBlock(toolName, input = {}) {
  if (String(toolName).startsWith("plain_")) {
    return "Un subagente no puede usar tools de memoria, tareas, review ni estado de Plain.";
  }

  const file = input.path ?? input.file_path ?? input.filename ?? input.file;
  if ((toolName === "write" || toolName === "edit") && file != null) {
    if (isMarkdown(file)) {
      return "Un subagente no puede escribir ni modificar archivos .md.";
    }
    if (isPlainState(file)) {
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
    if (/(?:>>?|tee|sed\s+-i|perl\s+-pi)[^;&|]*\.plain(?:\/|\b)/i.test(command)) {
      return "Un subagente no puede tocar el estado central desde bash.";
    }
  }

  return null;
}
