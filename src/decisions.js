// Decisions with an id.
//
// A decision the human makes is worth one line in the feature document, written
// in the same turn it is made: after a compaction the conversation is gone, the
// `## Decisions` section is not. Ids (`D7`) exist so a decision can be referenced
// by the unit that implements it, and so an orphan is visible.

import fs from "node:fs";
import path from "node:path";

export const DECISIONS_HEADING = "## Decisions";

// The question belongs to the agent; this option is the door out of it. The model
// writes its own in the user's language when it remembers; this is the fallback.
export const FOLLOW_UP = "keep analyzing";
const FOLLOW_UP_PATTERN = /^(keep analyzing|seguir analizando|seguir pensando)$/i;

/** The options shown to the human, always with a way to keep talking. */
export function askOptions(options) {
  const list = (Array.isArray(options) ? options : []).map((option) => String(option).trim()).filter(Boolean);
  if (list.some((option) => FOLLOW_UP_PATTERN.test(option))) return list;
  return [...list, FOLLOW_UP];
}

export function isFollowUp(choice) {
  return FOLLOW_UP_PATTERN.test(String(choice ?? "").trim());
}

/** `(agente) ` when the orchestrator decided under a delegated plan, nothing when the human did. */
export function decisionByPrefix(by) {
  return String(by ?? "").trim().toLowerCase() === "agent" ? "(agente) " : "";
}
export const DECISION_LINE = /^\s*-\s+(D\d+)\s+—\s+(.+)$/;

/** The `## Decisions` body, or "" when the section does not exist. */
export function decisionsSection(text) {
  const lines = String(text ?? "").split("\n");
  const start = lines.findIndex((line) => line.trim().toLowerCase() === DECISIONS_HEADING.toLowerCase());
  if (start < 0) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^##\s/.test(line));
  return (end < 0 ? rest : rest.slice(0, end)).join("\n");
}

/** `[{ id, text }]` in document order. */
export function parseDecisions(text) {
  const found = [];
  for (const line of decisionsSection(text).split("\n")) {
    const match = DECISION_LINE.exec(line);
    if (match) found.push({ id: match[1], text: match[2].trim() });
  }
  return found;
}

export function nextDecisionId(text) {
  const highest = parseDecisions(text).reduce((max, item) => Math.max(max, Number(item.id.slice(1)) || 0), 0);
  return `D${highest + 1}`;
}

/**
 * Replace or append the `## Decisions` section. The line goes at the end of that
 * section, never after the next heading: a decision filed under `## Units` is a
 * decision nobody finds.
 */
export function appendDecision(text, { id, line }) {
  const source = String(text ?? "");
  const lines = source.split("\n");
  const bullet = `- ${id} — ${String(line).trim()}`;
  const start = lines.findIndex((row) => row.trim().toLowerCase() === DECISIONS_HEADING.toLowerCase());

  if (start < 0) {
    const trimmed = source.replace(/\s+$/, "");
    return `${trimmed}${trimmed ? "\n\n" : ""}${DECISIONS_HEADING}\n\n${bullet}\n`;
  }

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s/.test(lines[index])) {
      end = index;
      break;
    }
  }
  const body = lines.slice(start + 1, end).join("\n").replace(/\s+$/, "");
  const section = `${DECISIONS_HEADING}\n${body ? `${body}\n` : "\n"}${bullet}\n`;
  const after = lines.slice(end).join("\n");
  return `${lines.slice(0, start).join("\n")}\n${section}${after ? `\n${after}` : ""}`;
}

/**
 * Decisions nobody implements: their id appears nowhere outside `## Decisions`.
 * A decision with no unit is either pending or forgotten, and both are worth
 * seeing before the work starts.
 */
export function orphanDecisions(text) {
  const source = String(text ?? "");
  const section = decisionsSection(source);
  const rest = source.replace(section, "");
  return parseDecisions(source)
    .filter((item) => !new RegExp(`\\b${item.id}\\b`).test(rest))
    .map((item) => item.id);
}

/** Read the doc if it exists; a missing file is not an error, it is "no doc yet". */
export function readDoc(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

export function docPath(cwd, featureDoc) {
  const value = String(featureDoc ?? "").trim();
  if (!value) return "";
  return path.isAbsolute(value) ? value : path.join(String(cwd ?? ""), value);
}
