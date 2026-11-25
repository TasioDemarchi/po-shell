/**
 * Display mode of the harness: `minimal` (one line per action) or `full` (Pi's
 * native view). The mode is data, so the CLI and the extension agree.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { poShellHome } from "./project.js";
import { readJson, writeJson } from "./util.js";

export const UI_MODES = ["minimal", "full"];
export const DEFAULT_UI_MODE = "minimal";

export const PANEL_MODES = ["auto", "on", "off"];
export const DEFAULT_PANEL_MODE = "auto";

export function panelMode(env = process.env) {
  const stored = String(readJson(uiConfigPath(env), null)?.panel ?? "")
    .trim()
    .toLowerCase();
  return PANEL_MODES.includes(stored) ? stored : DEFAULT_PANEL_MODE;
}

export function assertPanelMode(mode) {
  const next = String(mode ?? "")
    .trim()
    .toLowerCase();
  if (!PANEL_MODES.includes(next)) {
    throw new Error(`panel mode must be one of: ${PANEL_MODES.join(", ")}`);
  }
  return next;
}

/** `mode` and `panel` live in the same file: they are both display, not state. */
export function setPanelMode(mode, env = process.env) {
  const next = assertPanelMode(mode);
  const current = readJson(uiConfigPath(env), null) ?? {};
  writeJson(uiConfigPath(env), { ...current, mode: uiMode(env), panel: next });
  return next;
}

export function uiConfigPath(env = process.env) {
  return path.join(poShellHome(env), "ui.json");
}

/** `PO_SHELL_UI` wins over the stored file; the file wins over the default. */
export function uiMode(env = process.env) {
  const fromEnv = String(env.PO_SHELL_UI ?? "")
    .trim()
    .toLowerCase();
  if (UI_MODES.includes(fromEnv)) return fromEnv;
  const stored = readJson(uiConfigPath(env), null)?.mode;
  const normalized = String(stored ?? "")
    .trim()
    .toLowerCase();
  return UI_MODES.includes(normalized) ? normalized : DEFAULT_UI_MODE;
}

export function assertUiMode(mode) {
  const next = String(mode ?? "")
    .trim()
    .toLowerCase();
  if (!UI_MODES.includes(next)) {
    throw new Error(`ui mode must be one of: ${UI_MODES.join(", ")}`);
  }
  return next;
}

export function setUiMode(mode, env = process.env) {
  const next = assertUiMode(mode);
  const current = readJson(uiConfigPath(env), null) ?? {};
  writeJson(uiConfigPath(env), { ...current, mode: next });
  return next;
}

/** Pi's agent directory: `PI_CODING_AGENT_DIR` or `~/.pi/agent`. */
export function agentDir(env = process.env) {
  const configured = String(env.PI_CODING_AGENT_DIR ?? "").trim();
  if (configured) {
    if (configured === "~") return os.homedir();
    if (configured.startsWith("~/")) return path.join(os.homedir(), configured.slice(2));
    return configured;
  }
  return path.join(env.HOME ?? os.homedir(), ".pi", "agent");
}

export function agentSettingsPath(env = process.env) {
  return path.join(agentDir(env), "settings.json");
}

/**
 * Only the keys po-shell owns. Pure: the caller decides whether to write.
 * `minimal` hides thinking blocks, which turns them into the one-line label.
 */
export function uiSettingsPatch(settings, mode) {
  const next = assertUiMode(mode);
  return { ...(settings ?? {}), hideThinkingBlock: next === "minimal" };
}

/**
 * Persist the mode and align Pi's settings with it.
 * Returns what changed, so the CLI can report it without guessing.
 */
export function applyUiMode(mode, env = process.env) {
  const next = setUiMode(mode, env);
  const file = agentSettingsPath(env);
  const current = readJson(file, null);
  const before = current ?? {};
  const after = uiSettingsPatch(before, next);
  const unchanged = current !== null && JSON.stringify(before) === JSON.stringify(after);
  if (unchanged) return { mode: next, settings: file, changed: false, backup: "" };

  let backup = "";
  if (current !== null) {
    backup = `${file}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    fs.copyFileSync(file, backup);
  }
  writeJson(file, after);
  return { mode: next, settings: file, changed: true, backup };
}
