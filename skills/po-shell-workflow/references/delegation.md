# Delegation, in full

The protocol says when to delegate. This file says how, and what the kernel refuses.

## Roles

| Role | Reads | Runs | Writes | Web | Turns / time |
|---|---|---|---|---|---|
| `explorer` | repo, `read_outside` prefixes, project memory | no | no | yes | 16 / 420 s |
| `worker` | repo and its scratch | yes, the mission's checks | only `surfaces` | no | 40 / 900 s |
| `reviewer` | repo and its scratch | yes, in a copy of the repo | no | no | 15 / 600 s |

`planner` does not exist: the plan is the orchestrator's, because only it has the user's words and
what was already tried.

## The mission

The kernel refuses an incomplete one (`validateMission`):

| Field | Required | What it is |
|---|---|---|
| `task` | always | the goal, at least 10 characters |
| `done` | always | the observable items that mean finished |
| `build_test` | worker, reviewer | the exact command that proves it |
| `surfaces` | worker | repo-relative paths or globs it may write |
| `context_files` | recommended | files to read first; the task's `feature_doc` is added by the kernel |
| `out_of_scope` | recommended | what not to touch or decide |
| `read_outside` | explorer only | prefixes it may read outside the repo |

`buildMission` assembles them into MISSION / CONTEXT / EDIT SURFACES / DONE WHEN / OUT OF SCOPE. The
child has no `AGENTS.md` (`--no-context-files`) and no history: if the mission does not say it, the
child guesses.

## Budgets

The role sets the ceiling; the mission may ask for less, never more. No `max_turns` means the role
default, not unlimited.

## Result

- `status: ok` — the report is the child's own; verify it.
- `status: partial | turns_exceeded | budget_exceeded | timeout` — `partialReport`: last message, the
  progress notes, `git diff --stat`, and the warning that DONE WHEN was not confirmed. Read the diff.
- The full transcript is always in `~/.po-shell/projects/<id>/agents/<run>/`.

## Profiles and isolation

- `low` risk edits in place; `medium` and `high` delegate the writes. A `high` task without an
  approved plan cannot delegate at all.
- `po-shell task isolation worktree` (or `po_shell_task action=isolation` with a `reason`) gives the
  child its own branch and directory; the parent's tree never changes. Merging or discarding is the
  human's.
