---
name: po-shell-workflow
description: Use the po-shell harness for non-trivial code work. Activate when the task involves multiple files, risk, tests, review or continuation across sessions. Do not use for questions or one-line changes.
---

# po-shell workflow

## Base rule

**Small, understood work → inline, no ceremony.**
**Large, risky or non-resumable work → task + evidence + review.**

## When not to use

- Questions or explanations.
- One-line changes.
- When a task is already active: resume it, do not create another.
- When the request is still ambiguous: clarify first.

## Before touching code

1. `po_shell_status` to see the active task.
2. If this is a new project without `PROJECT.md`, draft `PROJECT.md` first (goal, MVP, non-goals, stack, constraints) and ask for approval before creating a feature doc or code.
3. If there is no task and the change is substantial: `po_shell_task` with `action: "new"`, `title`, `risk`, `scope`, `out_of_scope`.
4. If the task exists: move it to `exploring` or `implementing`.
5. If it is substantial or multi-session, follow the `feature-doc` skill and create `docs/features/<slug>.md`.
6. If it is small, do not create a feature doc.
7. `context_search` before re-deciding something that may already be recorded.
8. On resume, search memory first; if there is no hit or it is stale, read the feature doc.

## Risk classification

Risk is **blast radius and reversibility**, not effort.

| Risk | When |
|---|---|
| `low` | Docs, typo, one local file, no public contract, no data, no security, reversible |
| `medium` | Normal behavior change, 2–5 files, internal API, tests, performance, non-sensitive dependencies |
| `high` | Auth/permissions/secrets, payments/billing, migrations or data deletion, public contract/API, infra/deploy, concurrency, irreversible actions, >400 lines |

Rules:

- A single `high` trigger is enough.
- A small change in auth/payments/migrations is `high`.
- A large refactor covered by tests may be `medium`, but split it into units.
- If unsure between `medium` and `high`, choose `high` or ask.
- Add the risky paths declared by the project's `AGENTS.md`.
- `high` requires a plan + `po_shell_task action="approve"` before editing.

## Temporary files

- Put throwaway scripts and test data under `PO_SHELL_TMP` (the runtime's `TMPDIR`), never in the repo.
- Subagents get their own scratch; the parent removes it. A child does not delete.
- Tests use `mktemp` outside the worktree.
- Before returning, check `git status --short`; no `tmp/`, `.tmp/`, caches or fixtures may remain.
- If a temporary test becomes durable, promote it to `test/` or `scripts/`.
- `po-shell scratch list` shows leftovers; `po-shell scratch clean` removes ended sessions.

## Before a risky state change

- If the change touches migrations, SQLite, backups, restore, reviews or `~/.po-shell`: run `po-shell backup` and `po-shell integrity` first.
- Do not delete `~/.po-shell`, task JSON, reviews or `context.db` to “fix” state.
- If `po-shell integrity` reports an ERROR: stop and follow `docs/recovery.md`.
- `po-shell restore` requires `--yes`; do not restore without an explicit human request.

## During work

- One unit of behavior at a time.
- Test first when a deterministic test is possible.
- If the change touches auth, payments, migrations, shared contracts or concurrency: `risk: "high"`.
- If the task is `high`, save a concise plan in `po_shell_task`'s `plan` field, show a 5–10 line summary in chat, and use `po_shell_task` with `action: "approve"`; do not edit until the human approves.
- Do not ask for approval in chat: the `approve` selector is the approval. The selector shows the saved plan, so an empty plan is rejected.
- If the forecast exceeds ~400 lines: split into reviewable commits/units.

## Before saying "done"

1. `po_shell_task` → `phase: "checking"`.
2. `po_shell_check` (without arguments uses the project's central config).
3. If it fails: fix and repeat. Do not report success without evidence.
4. If it passes: `phase: "ready"`.

## Before a risky delivery

1. `po_shell_review` with `action: "freeze"`.
2. Review the frozen `diff.patch`, not the live worktree.
3. If risk is `high`, ask for an independent reviewer (`po_shell_delegate` with `role: "reviewer"`).
4. One bounded correction. If it fails again, `po_shell_ask`.
5. You may commit to save state; push/PR are the human's decision.

## Recovery

- `po-shell integrity` is the first diagnostic.
- `po-shell integrity --fix` imports missing memory mirrors; it does not overwrite existing rows.
- `po-shell backup` includes state, SQLite snapshot, global memory and a Git bundle.
- Read `docs/recovery.md` before restoring or editing central state.
- After recovery: `po-shell integrity`, `po-shell status`, `po-shell index`, then run checks.

## At close

- `po_shell_memory` with `action: "save"`: What / Why / Where / Learned.
- `po_shell_task` → `phase: "delivered"`.
- If something remains pending, write it in `next`.

## Delegation

Only for a named reason:

| Reason | Role |
|---|---|
| You need a repo map | `explorer` |
| There are 2+ independent units | `worker` (in parallel) |
| The session is running out of context | `worker` |
| The change is high risk | `reviewer` |

Never delegate "because it is large". Size is not a reason.
