# AGENTS.md — po-shell

Operational manual for the agent working **in this repo**. Pi discovers and loads it on every session.

Human-facing documentation, project scope and status live in `PROJECT.md`. Architecture lives in `docs/architecture.md`.

## Scope and precedence

- Applies to the po-shell repo.
- `prompts/po-shell-protocol.md` is the global orchestrator protocol.
- This file adds repo-specific rules: commands, paths, tests and conventions.
- If a local rule contradicts a hard protocol rule, ask before proceeding.

## Before touching anything

1. Run `npm test`.
2. Run `npm run check`.
3. If a task is active, check `po-shell status`.
4. Run `po-shell integrity` if the project already has central state.
5. If you are changing behavior, search for an existing decision or error with `po-shell context search`.

## Commands

```bash
npm test        # kernel, indexer, backup, scratch and launcher tests
npm run check   # syntax for src/ and the extension
po-shell index     # index docs and memories into SQLite FTS5
po-shell backup    # snapshot state + SQLite + repo bundle
po-shell backup list
po-shell restore <backup-dir> --yes
po-shell integrity # validate tasks, events, reviews, SQLite and memory
po-shell integrity --fix
po-shell policy test --tool bash --command "rm -rf build/"  # BLOQUEADO (2) | CONFIRMARÍA (3) | PERMITIDO (0)
po-shell policy test --tool write --path src/app.js         # refleja el perfil delegation de la tarea activa
po-shell scratch list    # session/subagent temporary dirs
po-shell scratch clean   # remove ended scratch
po-shell ui minimal      # one line per action; full restores Pi's view
po-shell ui full         # same, the other way
po-shell where     # show the project's central state
po-shell projects  # list projects with central state
po-shell checks suggest   # suggest checks from the stack
po-shell projects prune --dry-run  # show orphan states
po-shell context search "<topic>"   # search specs + memories
po-shell remember "<rule>" ...      # behavior directive
po-shell directives                # show active directives
sh scripts/install.sh   # from a checkout: verify Node/Pi, npm link, doctor
sh scripts/install.sh --alias po-shell-test   # run this checkout without moving the global po-shell
po-shell install        # verify the install; never installs anything
po-shell update [--yes]     # show or run the update for npm/pnpm/link
po-shell uninstall [--yes]  # uninstall the package; never touches ~/.po-shell
npm link        # put `po-shell` on PATH
po-shell doctor     # check Node, Pi, git, extension, providers
po-shell            # start the agent
```

`po-shell` loads the extension with `--extension` and the skills with `--skill`.
Do not also run `pi install ./po-shell`: it would load twice.

## Structure

```text
bin/po-shell.js            CLI entry point
src/kernel.js          tasks, phases, memory, checks, reviews
src/project.js         project identity and central state
src/indexer.js         SQLite FTS5 index of docs and memories
src/backup.js          backup, restore and integrity
src/scratch.js         session/subagent scratch, ledger and sweep
src/scratch-guard.js   blocks TMPDIR inside the repo in tests
src/context.js         context_search / context_get
src/checks.js          check detection and suggestions
src/policy.js          deny paths / guards (allow|confirm|block) / gate
src/destructive.js     lexical recognizer for destructive shell commands
src/confirm.js         destructive-command confirmation, UI-agnostic and fail-closed
src/context-guard.js   context pressure, levels and the state directive
src/delegate.js        subagent args per role, budget, report cap
src/subagent-policy.js child guard: no state, no .md, declared write surfaces
src/minimal-ui.js       one-line display per tool: icon, text, meta (English chrome)
src/ui.js               display mode (minimal|full) and Pi's thinking setting
src/cli.js             command parser
src/shell.js           launcher: resolves Pi and loads extension, skills and protocol
src/install.js         install report, method detection, update/uninstall plans
src/util.js            helpers
extensions/po-shell.ts     tools + hooks for Pi
prompts/po-shell-protocol.md   orchestrator protocol (global)
prompts/po-shell-subagent.md   common subagent contract
prompts/subagents/<role>.md    short role contracts: explore, worker, reviewer
skills/po-shell-workflow/  agent procedure
skills/agents-md-authoring/  skill for writing AGENTS.md
skills/skill-md-authoring/   skill for writing SKILL.md
skills/feature-doc/          skill for docs/features/<slug>.md
scripts/install.mjs         installer entry: verify, never install
scripts/install.sh          checkout bootstrap: Node/Pi checks, npm link, doctor
templates/             AGENTS.md, PROJECT.md and TASK.md templates
test/                  per-module tests
docs/architecture.md   architecture, components and memory
docs/recovery.md       backup, restore and recovery runbook
docs/scratch.md        temporary files and cleanup policy
docs/self-hosting.md   dogfooding and self-modification rules
docs/subagentes.md     gentle-shell subagents vs po_shell_delegate, port backlog
docs/status.md         state, pending, paused, discarded
docs/agents-md-y-skill-md-investigacion.md  reference research
```

## Change rules

- **Do not rewrite Pi or its TUI.** po-shell is a product on top of Pi. Display changes go through `registerToolRenderer`/`ctx.ui`: collapsed is ours, expanded delegates to Pi.
- **TUI chrome is English; the agent answers in the user's language.** One-line rows, dialog titles and buttons, toasts and the thinking label are English. Tool results, CLI output and docs keep their language.
- **Zero runtime dependencies.** Only Node 22+ and Git.
- **Tests for every kernel or policy change.** If you touch a rule, add or adjust a test.
- **Small, reviewable changes.** One unit of behavior at a time.
- **Do not break the CLI without updating `README.md` and `PROJECT.md`.**
- **Do not add features that are not in this file or approved in conversation.**
- **Do not store secrets** in code, tests, memory or logs.
- **Temporary files stay out of the repo.** Use `PO_SHELL_TMP`/`TMPDIR`; cleanup belongs to the runtime.
- **Promote durable tests.** A temporary script/test that must remain goes to `test/` or `scripts/` with a normal name.
- **Do not add ADRs.** Decisions go in memory.
- **Documentation:** if a section of this file exceeds ~150–200 lines, split it into `docs/`. Do not create a doc before it hurts.

## Memory operations

Search with `context_search` (specs + memories) and `context_get` for detail.
For errors from other projects, use `context_search` with `all_projects: true`; it only crosses memories, never foreign specs.
Save with `po_shell_memory` with `action: "save"`.

Save when:

- you solved a bug whose cause was not obvious;
- you made a decision that affects more than one file or a contract;
- you discovered a domain or environment constraint;
- the human asked for a behavior rule;
- a task/feature needs a short `state` or `feature` snapshot for fast resume.

Use stable topics such as `state/<task-id>`, `feature/<slug>` or `session/current` so snapshots overwrite instead of accumulating.

Do not save trivial changes, what is already in the code, temporary plans or secrets.

Base format:

```text
WHAT: ...
WHY: ...
WHERE: ...
LEARNED: ...
```

For `bugfix`, add when useful:

```text
SYMPTOM: ...
CAUSE: ...
FIX: ...
PREVENTION: ...
```

Directives: `po-shell remember` (or `po_shell_memory` with `type: "behavior"`, `scope`, `priority`, `trigger`). They are injected at session start.
`--scope global` is stored in `~/.po-shell/memory`; everything else in `~/.po-shell/projects/<id>/memory`.
The full memory and index design is in `docs/architecture.md`.

## Workflow

1. If this is a new project without `PROJECT.md`, draft it and get human approval before feature docs or code.
2. If the task is substantial, create a task with `po_shell_task`.
3. Explore before editing.
4. Implement one unit at a time.
5. Run `npm test` and `npm run check`.
6. Put throwaway scripts and test data in `PO_SHELL_TMP`/`TMPDIR`, never in the repo.
7. Before a risky state change, migration or recovery test: `po-shell backup` and `po-shell integrity`.
8. If the change is risky, freeze the review with `po_shell_review freeze`.
9. Save memory if there is a durable conclusion.
10. You may commit to save state. Push, PR and deploy are the human's decision.
11. If recovery or state integrity changed, update `docs/recovery.md` and add tests.

## Temporary files

- Session scratch is `PO_SHELL_TMP`, normally `~/.po-shell/tmp/po-shell-XXXXXX/`.
- Subagents get `PO_SHELL_TMP/po-shell-sub-XXXXXX/`; the parent removes it.
- Do not create `tmp/`, `.tmp/`, test fixtures or caches inside the repo.
- Tests use `mktemp` outside the worktree; if scratch must live inside, use an ignored path and remove it before finishing.
- `po-shell scratch list` inspects leftovers; `po-shell scratch clean` removes ended sessions.
- If a temporary test becomes real, move it to `test/` and commit it.

## Recovery

- Never delete `~/.po-shell`, `context.db`, task JSON or reviews to "fix" an error.
- Stop and run `po-shell integrity` before editing recovery state.
- Follow `docs/recovery.md`; do not improvise a restore.
- `po-shell restore` requires `--yes` and is a human decision unless explicitly requested.
- `po-shell integrity --fix` only imports missing memory rows; it does not overwrite existing ones.

## Definition of done

A change is done when:

- `npm test` passes;
- `npm run check` passes;
- new behavior is covered by a test;
- `README.md` or `PROJECT.md` was updated if usage or scope changed;
- there are no secrets in the diff;
- the diff can be reviewed without reading the whole repo;
- any durable decision is in memory;
- recovery behavior is covered by `docs/recovery.md` and tests if touched;
- no scratch path or temporary artifact remains in the diff.

## Invariants

1. **The model proposes; the kernel disposes.** What cannot be an exception lives in code.
2. **No evidence, not done.** A check that does not run is not a check.
3. **Review exactly what is delivered.** Frozen review + hash.
4. **The human owns push and delivery.** Commits are allowed to save state; push, PR and deploy are never delegated.
5. **One task, one phase, one next action.**
6. **Delegate for a reason, not for size.**
7. **State lives in inspectable files or a DB, not in the model's head.**
8. **Policy is not a sandbox.** Combine it with an OS barrier; it does not replace one.
9. **Zero runtime dependencies.**
10. **Secrets are never stored in memory.**

## Project context

- Goal, scope, users and constraints: `PROJECT.md`.
- Architecture, components and memory: `docs/architecture.md`.
- State, pending and discarded: `docs/status.md`.
- Rules for writing instructions: `docs/agents-md-y-skill-md-investigacion.md`.

Read those files only when the task needs them.
