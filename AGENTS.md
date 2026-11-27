# AGENTS.md — po-shell

Operational manual for the agent working **in this repo**. Pi loads it on every session. Human
documentation lives in `PROJECT.md`; architecture in `docs/architecture.md`.

## Scope and precedence

- Applies to the po-shell repo; the global protocol is `prompts/po-shell-protocol.md`.
- This file adds what the protocol cannot know: commands, layout, tests, repo conventions.
- If a local rule contradicts a hard protocol rule, ask before proceeding.

## Before touching anything

1. `npm test` and `npm run check` to know the baseline.
2. `po_shell_status` if a task is active; `po-shell integrity` if state was touched.

## Commands

```bash
npm test        # kernel, indexer, backup, scratch, UI and launcher tests
npm run check   # syntax for src/, scripts/ and the extension
npm run docs:check   # references, frontmatter, ceilings, orphan decisions

po-shell index [--rebuild]   # index docs and memories into SQLite FTS5
po-shell backup              # snapshot state + SQLite + repo bundle
po-shell backup list
po-shell restore <dir> --yes # human decision
po-shell integrity [--fix]   # validate tasks, events, reviews, SQLite, memory
po-shell where               # this project's central state
po-shell projects [prune --dry-run]
po-shell scratch list|clean  # session and subagent temp dirs
po-shell ui [minimal|full]   # display mode; `ui panel` for the panel
po-shell checks suggest      # suggest checks from the stack
po-shell context search "<topic>"
po-shell remember "<rule>"   # behavior directive
po-shell directives
po-shell policy test --tool bash --command "rm -rf build/"   # 2 blocked, 3 confirm, 0 allowed
po-shell doctor | install | update [--yes] | uninstall [--yes]
sh scripts/install.sh [--alias po-shell-test]   # from a checkout
po-shell                     # start the agent
```

`po-shell` loads the extension with `--extension` and the skills with `--skill`. Do not also run
`pi install ./po-shell`: it would load twice.

The `po-shell` in `PATH` runs the `main` worktree (`/home/tachii/dev/po-shell`). While working on a
branch, launch from the checkout you are editing with `node bin/po-shell.js`: a session started
anywhere else loads the code of `main`, and a delegation launched from it builds its mission with
that older kernel.

## Map

```text
bin/po-shell.js            CLI entry point
src/kernel.js          tasks, phases, memory, checks, reviews, policy gate
src/project.js         project identity and central state
src/indexer.js         SQLite FTS5 index of docs and memories
src/decisions.js       decision ids, append into the feature doc, orphans
src/doc-checks.js      document consistency (`npm run docs:check`)
src/backup.js          backup, restore and integrity
src/scratch.js         session/subagent scratch, ledger and sweep
src/context.js         context_search / context_get
src/checks.js          check detection and suggestions
src/policy.js          deny paths / guards / gate
src/destructive.js     lexical recognizer for destructive shell commands
src/context-guard.js   context pressure, levels, state directive
src/delegate.js        subagent mission, budgets, report cap
src/subagent-roles.js  role matrix: tools, write, bash, web, budgets, mission contract
src/subagent-policy.js child guard
src/subagent-memory.js read-only project memory for the explorer
src/web-fetch.js       web_fetch: public destinations only, caps, egress budget
src/worktree.js        isolated worktree per child
src/minimal-ui.js      one-line rows, footer, panel, windows (English chrome)
src/stats.js           /usage block
src/nan-usage.js       /plan: Nan credits endpoint
src/ui.js              display mode and Pi's thinking setting
src/cli.js             command parser
src/shell.js           launcher: resolves Pi, extension, skills, protocol
src/install.js         install report, update/uninstall plans
src/util.js            helpers
extensions/po-shell.ts          tools + hooks
extensions/po-shell-subagent.ts guard loaded in children
prompts/po-shell-protocol.md    orchestrator protocol (global)
prompts/subagents/<role>.md     explore, worker, reviewer
skills/                         po-shell-workflow, feature-doc, agents-md-authoring, skill-md-authoring
scripts/                        install, check-docs, measure-context
templates/                      PROJECT.md, AGENTS.md, TASK.md
test/                           per-module tests
docs/                           architecture, recovery, scratch, self-hosting, subagentes, features/
```

## Change rules

- **Do not rewrite Pi or its TUI.** Display changes go through `registerToolRenderer`/`ctx.ui`. The
  tool rows are ours in both modes, collapsed and expanded; the rest of Pi's TUI is Pi's, and
  `ui full` hands the rows back. Pi **swallows** an exception thrown inside a renderer and draws its
  native row instead, so a broken renderer looks like a change that was never applied: verify a TUI
  change in a real pty (`tmux` + `pi --extension …` + `capture-pane`), not only with tests.
- **TUI chrome is English; the agent answers in the user's language.** Rows, dialog titles and
  buttons, toasts and the thinking label are English; results, CLI output and docs keep theirs.
- **Zero runtime dependencies.** Node 22+ and Git.
- **Tests for every kernel or policy change.** Touching a rule means touching a test.
- **Small, reviewable changes.** One unit of behavior at a time.
- **Do not break the CLI without updating `README.md` and `PROJECT.md`.**
- **Do not add features that are not in this file or approved in conversation.**
- **Do not store secrets** in code, tests, memory or logs.
- **The project documents are the orchestrator's.** `PROJECT.md`, `AGENTS.md`, `README.md` and
  `docs/features/` are written by the parent in any profile; a child never writes `.md`. Code stays
  delegated: `delegate-writes` bounds the mutations, not the documentation.
- **Temporary files stay out of the repo.** `PO_SHELL_TMP`/`TMPDIR`; the runtime cleans up.
- **Promote durable tests.** A throwaway that must remain goes to `test/` or `scripts/`.
- **Decisions are not ADRs.** They go to memory and to the feature doc with an id.
- **Documentation:** a section that outgrows ~150–200 lines splits into `docs/`. Do not create a doc
  before it hurts.

## Definition of done

- `npm test`, `npm run check` and `npm run docs:check` pass.
- New behavior is covered by a test.
- `README.md` or `PROJECT.md` updated if usage or scope changed.
- No secrets in the diff; the diff is reviewable without reading the whole repo.
- Durable decisions captured (`D<n>`) and memory saved if it matters.
- `docs/recovery.md` and its tests updated if recovery changed.
- No scratch path or temporary artifact in the diff.
- `delivered` means committed and ready to merge, never merged: the merge, the push and the deploy
  stay with the human.

## Invariants

1. **The model proposes; the kernel disposes.** What cannot be an exception lives in code.
2. **No evidence, not done.** A check that does not run is not a check.
3. **Review exactly what is delivered.** Frozen review + hash.
4. **The human owns push and delivery.** Commits save state; push, PR and deploy are never delegated.
5. **One task, one phase, one next action.**
6. **Delegate for a reason, not for size.**
7. **State lives in inspectable files or a DB, not in the model's head.**
8. **Policy is not a sandbox.** Combine it with an OS barrier.
9. **Zero runtime dependencies.**
10. **Secrets are never stored in memory.**

## Project context

- Goal, scope, users, constraints, state, pending and discarded: `PROJECT.md`.
- Architecture, components and memory design: `docs/architecture.md`.
- Running procedure, risk table and delegation: the `po-shell-workflow` skill.

Read them only when the task needs them.
