// What each subagent role may do, in code.
//
// A role is not a prompt: it is a capability set the harness enforces on both
// sides — the parent validates the delegation before launching it, and the child
// refuses at `tool_call` even if the parent handed it a wider tool list.
//
// Three roles, three capabilities:
// - explorer: reads (the repo, the paths a mission grants, the web), never writes.
// - worker: writes inside its surfaces, runs checks, nothing else.
// - reviewer: verifies by executing commands in its own scratch copy, never in
//   the repository and never with a write tool.

export const SUBAGENT_ROLES = ["explorer", "worker", "reviewer"];

/** Tools that only look at the filesystem. */
export const READ_TOOLS = ["read", "grep", "find", "ls"];
/** Web tools. The explorer gets them, nobody else: a child with network is a child that can exfiltrate. */
export const WEB_TOOLS = ["web_search", "web_fetch", "fetch_content", "get_search_content", "source_check"];
/** Tools that change the worktree. */
export const WRITE_TOOLS = ["edit", "write"];

export const ROLE_RULES = {
  explorer: {
    tools: [...READ_TOOLS],
    write: false,
    bash: false,
    web: true,
    // Reads outside the repo only along the prefixes the mission grants.
    outside: "granted",
    maxTurns: 12,
    timeoutSeconds: 300,
  },
  worker: {
    tools: [...READ_TOOLS, "bash", ...WRITE_TOOLS],
    write: true,
    bash: true,
    web: false,
    outside: "scratch",
    maxTurns: 40,
    timeoutSeconds: 900,
  },
  reviewer: {
    tools: [...READ_TOOLS, "bash"],
    write: false,
    bash: true,
    web: false,
    outside: "scratch",
    maxTurns: 15,
    timeoutSeconds: 600,
  },
};

export function isSubagentRole(role) {
  return SUBAGENT_ROLES.includes(String(role ?? "").trim().toLowerCase());
}

/** The rules of a role, or a throw: an unknown role must never fall back to worker. */
export function roleRules(role) {
  const key = String(role ?? "").trim().toLowerCase();
  const rules = ROLE_RULES[key];
  if (!rules) {
    throw new Error(`unknown subagent role: ${role || "(empty)"} — use one of ${SUBAGENT_ROLES.join(", ")}`);
  }
  return rules;
}

export function roleAllows(role, capability) {
  const rules = roleRules(role);
  if (capability === "write") return rules.write;
  if (capability === "bash") return rules.bash;
  if (capability === "web") return rules.web;
  return rules.tools.includes(capability);
}

/**
 * The tool list a role gets, validated against what the parent asked for.
 * Asking for a tool the role cannot have is an error, not a silent narrowing:
 * a parent that believes it sent a writing explorer must find out now.
 */
export function roleTools(role, requested) {
  const rules = roleRules(role);
  const wanted = Array.isArray(requested) && requested.length ? requested.map((tool) => String(tool).trim()).filter(Boolean) : rules.tools;
  const refused = wanted.filter((tool) => !rules.tools.includes(tool));
  if (refused.length) {
    throw new Error(
      `${role} cannot use ${refused.join(", ")}: its tools are ${rules.tools.join(", ")}`,
    );
  }
  return [...new Set(wanted)];
}

/**
 * Budgets: the role sets the ceiling, the mission may ask for less.
 * Not asking means the role's default, never "unlimited".
 */
export function roleBudgets(role, { maxTurns, maxTokens, timeoutSeconds } = {}) {
  const rules = roleRules(role);
  const turns = Math.trunc(Number(maxTurns) || 0);
  const timeout = Math.trunc(Number(timeoutSeconds) || 0);
  return {
    maxTurns: turns > 0 ? Math.min(turns, rules.maxTurns) : rules.maxTurns,
    maxTokens: Math.trunc(Number(maxTokens) || 0) || 0,
    timeoutSeconds: timeout > 0 ? Math.min(timeout, rules.timeoutSeconds) : rules.timeoutSeconds,
  };
}

// Every role declares what "finished" means. The roles that run commands must
// name them: a child with a shell and no authorized check invents one.
const NEEDS = {
  explorer: { done: true, buildTest: false, surfaces: false },
  worker: { done: true, buildTest: true, surfaces: true },
  reviewer: { done: true, buildTest: true, surfaces: false },
};

/**
 * The delegation contract, as a predicate the kernel owns.
 *
 * This is not advice printed in a prompt: a delegation that fails here never
 * launches, so a child can never start without knowing what finished looks like,
 * which command proves it, or where it may write.
 */
export function validateMission({ role, task, done, buildTest, surfaces, contextFiles, readOutside } = {}) {
  const errors = [];
  let rules;
  try {
    rules = roleRules(role);
  } catch (error) {
    return { ok: false, errors: [error instanceof Error ? error.message : String(error)] };
  }
  const needs = NEEDS[String(role).trim().toLowerCase()];
  const goal = String(task ?? "").trim();
  const items = (Array.isArray(done) ? done : []).map((item) => String(item).trim()).filter(Boolean);
  const command = String(buildTest ?? "").trim();
  const writeSurfaces = (Array.isArray(surfaces) ? surfaces : []).map((item) => String(item).trim()).filter(Boolean);
  const outside = (Array.isArray(readOutside) ? readOutside : []).map((item) => String(item).trim()).filter(Boolean);

  const article = /^[aeiou]/i.test(String(role).trim()) ? "an" : "a";
  if (goal.length < 10) errors.push("`task` must state the mission in at least 10 characters");
  if (needs.done && items.length === 0) errors.push(`${article} ${role} needs \`done\`: what finished looks like`);
  if (needs.buildTest && !command) errors.push(`${article} ${role} needs \`build_test\`: the exact command that proves it`);
  if (needs.surfaces && writeSurfaces.length === 0) errors.push(`${article} ${role} needs \`surfaces\`: where it may write`);
  if (writeSurfaces.length && !rules.write) errors.push(`${role} does not write, so \`surfaces\` makes no sense`);
  if (outside.length && rules.outside !== "granted") {
    errors.push(`only an explorer reads outside the repo; ${role} keeps reads inside the project and its scratch`);
  }

  return { ok: errors.length === 0, errors, rules };
}

/** True when `target` (absolute) sits under one of the granted prefixes (absolute). */
export function withinPrefixes(target, prefixes) {
  const value = String(target ?? "").replace(/\\/g, "/").replace(/\/$/, "");
  return (Array.isArray(prefixes) ? prefixes : []).some((prefix) => {
    const clean = String(prefix ?? "").replace(/\\/g, "/").replace(/\/$/, "");
    return clean && (value === clean || value.startsWith(`${clean}/`));
  });
}
