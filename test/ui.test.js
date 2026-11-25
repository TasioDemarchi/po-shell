import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  agentSettingsPath,
  applyUiMode,
  assertUiMode,
  panelMode,
  setPanelMode,
  setUiMode,
  uiConfigPath,
  uiMode,
  uiSettingsPatch,
} from "../src/ui.js";

function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "po-shell-ui-"));
  return {
    root,
    env: {
      HOME: path.join(root, "home"),
      PO_SHELL_HOME: path.join(root, "state"),
      PI_CODING_AGENT_DIR: path.join(root, "agent"),
    },
  };
}

test("the default mode is minimal", () => {
  const { env } = sandbox();
  assert.equal(uiMode(env), "minimal");
});

test("PO_SHELL_UI wins over the stored file", () => {
  const { env } = sandbox();
  setUiMode("full", env);
  assert.equal(uiMode(env), "full");
  assert.equal(uiMode({ ...env, PO_SHELL_UI: "minimal" }), "minimal");
  assert.equal(uiMode({ ...env, PO_SHELL_UI: "nonsense" }), "full");
});

test("setUiMode persists a valid mode and rejects anything else", () => {
  const { env } = sandbox();
  assert.equal(setUiMode("full", env), "full");
  const stored = JSON.parse(fs.readFileSync(uiConfigPath(env), "utf8"));
  assert.deepEqual(stored, { mode: "full" });
  assert.throws(() => setUiMode("chrome", env), /minimal, full/);
  assert.throws(() => assertUiMode(""), /minimal, full/);
});

test("uiSettingsPatch touches only hideThinkingBlock", () => {
  assert.deepEqual(uiSettingsPatch({ theme: "dark" }, "minimal"), { theme: "dark", hideThinkingBlock: true });
  assert.deepEqual(uiSettingsPatch({ hideThinkingBlock: true }, "full"), { hideThinkingBlock: false });
  assert.deepEqual(uiSettingsPatch(null, "full"), { hideThinkingBlock: false });
});

test("agentSettingsPath honours PI_CODING_AGENT_DIR and falls back to HOME", () => {
  const { root, env } = sandbox();
  assert.equal(agentSettingsPath(env), path.join(root, "agent", "settings.json"));
  const { PI_CODING_AGENT_DIR: _ignored, ...withoutAgentDir } = env;
  assert.equal(agentSettingsPath(withoutAgentDir), path.join(root, "home", ".pi", "agent", "settings.json"));
});

test("applyUiMode writes the mode and aligns Pi's setting with a backup", () => {
  const { env } = sandbox();
  const settings = agentSettingsPath(env);

  const first = applyUiMode("minimal", env);
  assert.equal(first.mode, "minimal");
  assert.equal(first.changed, true);
  assert.equal(first.backup, "");
  assert.deepEqual(JSON.parse(fs.readFileSync(settings, "utf8")), { hideThinkingBlock: true });

  const again = applyUiMode("minimal", env);
  assert.equal(again.changed, false);
  assert.equal(again.backup, "");

  const full = applyUiMode("full", env);
  assert.equal(full.changed, true);
  assert.ok(full.backup.startsWith(`${settings}.bak-`));
  assert.equal(fs.existsSync(full.backup), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(settings, "utf8")), { hideThinkingBlock: false });
  assert.deepEqual(JSON.parse(fs.readFileSync(full.backup, "utf8")), { hideThinkingBlock: true });
  assert.equal(uiMode(env), "full");
});

test("the panel defaults to auto and lives next to the mode", () => {
  const { env } = sandbox();
  assert.equal(panelMode(env), "auto");

  assert.equal(setPanelMode("on", env), "on");
  assert.equal(panelMode(env), "on");
  assert.equal(uiMode(env), "minimal");

  setUiMode("full", env);
  assert.equal(uiMode(env), "full");
  assert.equal(panelMode(env), "on", "changing the mode must not drop the panel");

  setPanelMode("AUTO", env);
  assert.equal(panelMode(env), "auto");

  assert.throws(() => setPanelMode("sometimes", env), /panel mode must be one of/);
  assert.equal(panelMode(env), "auto", "an invalid value leaves the file alone");
});
