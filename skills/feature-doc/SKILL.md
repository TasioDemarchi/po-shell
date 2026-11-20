---
name: feature-doc
description: Create and maintain the single feature document at docs/features/<slug>.md. Use for substantial, multi-session, risky or non-resumable work. Do not use for small one-session changes.
---

# Feature doc

A feature doc is the only file for a feature. It is not SDD, not a form and not a separate plan.

## When to use

- The work is substantial, risky or multi-session.
- It cannot be resumed from the request and `git diff` alone.
- There is more than one requirement or more than one task.
- The human asked for a feature, not a one-line change.

## When not to use

- Small one-session change.
- Question, explanation or review.
- Obvious bug with a local fix.
- Work that fits entirely in one kernel task.

## File

```text
docs/features/<slug>.md
```

One file. Do not create separate `brief.md`, `spec.md`, `plan.md` and `tasks.md` per feature.

## Template

```markdown
---
type: feature
status: idea
---

# Feature: <name>

Risk: low | medium | high

## Outcome
What can the user do or see when this is done?

## Pain
What problem does it solve, and for whom?

## Constraints
Stack, time, security, compatibility, cost.

## Non-goals
What this feature does NOT do.

## Specs
- S1. ...
  Accept: ...
  Check: ...
- S2. ...

## Assumptions
- We assume...
- If false, tell me.

## Decisions
- D1. ...
  Why: ...
  Rejected alternative: ...

## Tasks
- [ ] T1. ... — S1 — check: ...
- [ ] T2. ... — S2 — check: ... — depends on T1

## State
- Active: T1
- Last check: ...
- Blocker: none
- Next: T2

## Log
- L1. Original request from the human, verbatim.
```

## How to write it

1. The agent writes the draft from the conversation. It does not interrogate.
2. It restates pain, outcome, constraints and non-goals.
3. It asks **at most 3 questions** in one round.
4. Each question includes a recommendation and consequence.
5. If it can assume, it assumes and records it in `Assumptions`.
6. It asks for one approval before implementation.

## What gets indexed

Stable sections are indexed:

- Outcome
- Pain
- Constraints
- Non-goals
- Specs
- Assumptions
- Decisions

Not indexed:

- Tasks
- State
- Log
- Open questions

The feature doc is the precise source for state. Memory can hold a fast `state` or `feature` snapshot, but it is not the authority.

## Resume order

1. Search memory for the feature or task.
2. If the snapshot is fresh and complete, use it.
3. If there is no hit, it is stale, or it lacks detail, read this feature doc.
4. If there is no feature doc, read the relevant code/docs.

After a task transition, update the memory snapshot and the feature doc.

## Rules

- One feature = one observable outcome.
- One task = one check.
- One task = one session.
- If the file exceeds ~150–200 lines, split it.
- Edit only affected lines; do not rewrite the whole file.
- Mark `done` only with observed evidence.
- State in this file; state snapshots and durable lessons in memory.
- If scope changes, update `Specs`, `Tasks` and `Log`.
- Do not add requirements the human did not ask for.
