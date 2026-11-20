---
name: agents-md-authoring
description: Write or review an AGENTS.md for coding agents. Use when creating, auditing, shortening or migrating project instructions, or when AGENTS.md grows too large, contains contradictions or mixes documentation with behavior.
---

# AGENTS.md authoring

Write `AGENTS.md` as a permanent operational manual, not as product documentation.

A new agent should know, in few tokens:

- who it is;
- what scope it has;
- which rules are non-negotiable;
- how it works;
- how it verifies;
- what it does not do.

## When to use

- Create a global or project `AGENTS.md`.
- Review an existing one.
- Reduce duplication with README/PROJECT/docs.
- Migrate a protocol or prompt into `AGENTS.md`.
- Resolve contradictory rules.
- Decide what belongs in `AGENTS.md` and what belongs in a skill.

## When not to use

- To document architecture or API: that goes in `PROJECT.md` or `docs/`.
- For a full style guide: use a linter.
- For long procedures: use a skill.
- For one-off tasks: no permanent file needed.

## Procedure

1. **Define scope and audience.** Global, repo, subdirectory or monorepo. One file per scope; nested for subprojects.
2. **Inventory what the agent cannot discover alone.** Build/test commands, layout, conventions, gotchas, delivery rules. Do not copy what README or code already has.
3. **Separate three layers.** Hard rules, workflow, operational reference.
4. **Write the critical part first.** Role, scope, precedence, non-negotiables, risk, approval.
5. **Put reference in the middle.** Commands, map, examples, conventions.
6. **Close with operations.** Definition of done, checklist, do-not list, pointers.
7. **Shorten.** Target ≤200 lines. If it does not fit, move detail to docs or skills.
8. **Validate.** Look for contradictions, vagueness, unverifiable rules, duplication and secrets.

## Template

```markdown
# AGENTS.md — <scope>

<1–3 lines of purpose and audience>

## Scope and precedence
- Applies to...
- If conflict:...
- Explicit human request wins.

## Non-negotiable rules
- ...
- ...

## Workflow
1. ...
2. ...
3. ...

## Commands
```bash
...
```

## Project map
```text
...
```

## Conventions and examples
- ...
- Canonical example: ...

## Memory and context
- When to save...
- Format...

## Definition of done
- ...

## Do not
- ...

## Pointers
- Detail: `docs/...`
- Procedure: skill `...`
```

## Placement

| Zone | Content | Why |
|---|---|---|
| Start | Role, scope, precedence, hard rules, workflow, risk | Read first and weighted most |
| Middle | Commands, map, conventions, examples, formats | Reference; critical rules do not belong here |
| End | Definition of done, checklist, do-not list, pointers | Closest to the user request |

Never bury a critical rule in the middle. If it is there, move it up or repeat it in the final checklist.

## Limits

| File | Ideal | Guardrail |
|---|---:|---:|
| Global `AGENTS.md` | 60–120 lines / ~800–1,500 tokens | ≤200 lines |
| Project `AGENTS.md` | 80–180 lines / ~1–2,500 tokens | ≤200 lines |
| Path-scoped rule | 30–100 lines | ≤500 lines |
| Monorepo | One `AGENTS.md` per subproject | ≤32 KiB per Codex chain |

If a file exceeds 200 lines, split it. Do not compress it until it becomes ambiguous.

## Format

- Markdown, stable `##` headings.
- One idea per bullet.
- Imperative verbs.
- Commands in fences; paths in backticks.
- Canonical examples, not every edge case.
- Tables only for decision matrices.
- XML only to delimit data, not for everything.
- Same terminology throughout.

Good:

```markdown
- Use 2-space indentation.
- Run `npm test` before committing.
- Handlers live in `src/api/handlers/`.
```

Bad:

```markdown
- Format well.
- Test your changes.
- Keep things organized.
```

## Golden rules

1. **One source of truth.** Do not duplicate `PROJECT.md`, README or docs.
2. **Pointers, not copies.** Reference instead of pasting.
3. **Explicit precedence.** Say who wins on conflict.
4. **Verifiable rule.** If it cannot be checked, it is not a rule.
5. **Minimal does not mean short.** If context is missing, the agent guesses.
6. **Consistency.** Two contradictory rules make the model choose arbitrarily.
7. **No secrets.** Never credentials, tokens or personal data.
8. **Measure.** Real tokens + violation rate + task success.

## Final checklist

- [ ] ≤200 lines.
- [ ] Role, scope and precedence at the start.
- [ ] Hard rules at the start.
- [ ] Commands and map in the middle.
- [ ] Definition of done and do-not list at the end.
- [ ] No duplicated docs.
- [ ] No contradictions.
- [ ] Concrete, verifiable instructions.
- [ ] Pointers instead of copies.
- [ ] No secrets.
