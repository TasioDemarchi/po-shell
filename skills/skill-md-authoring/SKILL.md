---
name: skill-md-authoring
description: Write or review a SKILL.md for coding agents. Use when creating a skill, improving activation, shortening its body, moving detail to references/ or turning a long procedure into a reusable skill.
---

# SKILL.md authoring

Write a skill as an on-demand procedure, not as permanent documentation.

A skill has three levels:

1. metadata: `name` + `description` (~100 tokens);
2. `SKILL.md` body: loaded when activated;
3. `references/`, `scripts/`, `assets/`: read only when needed.

## When to use

- Create a new skill.
- Improve an existing skill's routing.
- Shorten a `SKILL.md` that grew too large.
- Separate procedure from reference.
- Turn a reusable prompt into a skill.
- Review why a skill over- or under-triggers.

## When not to use

- For permanent repo rules: use `AGENTS.md`.
- For architecture documentation: use `docs/`.
- For deterministic code: use `scripts/`.
- For a one-off task: no skill needed.

## Frontmatter

```yaml
---
name: <name>
description: <what it does + when to use it + activation keywords>
---
```

Rules:

- `name`: ≤64 characters, lowercase, numbers and hyphens.
- `description`: ≤1,024 characters; say what it does, when to use it and when not.
- The description is routing, not marketing.
- Include the words the user would say.
- If the skill has side effects, consider `disable-model-invocation: true`.
- In Claude Code, `description` + `when_to_use` share a 1,536-character limit.

Good:

```yaml
description: Write or review an AGENTS.md. Use when creating, shortening, migrating or auditing project instructions.
```

Bad:

```yaml
description: Helps with documentation.
```

## Body

```markdown
# <Name>

<1–2 lines of outcome>

## When to use
- ...

## When not to use
- ...

## Procedure
1. ...
2. ...
3. ...

## Commands
```bash
...
```

## Examples
### Canonical example
...

## Errors and edge cases
- ...

## Verification
- [ ] ...

## References
- `references/...`
- `scripts/...`
```

## Placement

| Zone | Content | Why |
|---|---|---|
| Start | Outcome, triggers, when not to use, prerequisites | Decides activation and prevents over-triggering |
| Middle | Steps, commands, examples, formats | It is the procedure |
| End | Edge cases, verification, references | Closes the work and points to detail |

## Limits

| Part | Ideal | Limit |
|---|---:|---:|
| Metadata | 3–5 lines / ~50–100 tokens | 1,024-char description |
| `SKILL.md` body | 60–150 lines / ~1–3k tokens | <500 lines / <5k tokens |
| `references/*.md` | as needed | on demand |
| `scripts/` | executable code | not read whole |

If the body exceeds 150 lines, move detail to `references/`. If it exceeds 500, it is badly structured.

## Progressive disclosure

```
metadata → SKILL.md → references/scripts/assets
```

- Metadata is always in the system prompt.
- Body loads only when activated; it stays in context while active.
- References load only when the agent opens them.
- Heavy code goes in scripts; the model runs it, not reads it.
- Reference one level deep from `SKILL.md`.

## Format

- Markdown; YAML frontmatter.
- Numbered steps for procedures.
- One bullet per idea.
- Exact commands in fences.
- Canonical input/output examples.
- Avoid long paragraphs.
- Avoid duplicating `AGENTS.md`.
- Avoid "explain everything"; say what to do.

## Token savings

- Short, specific metadata.
- Operational body, no theory.
- Move theory to `references/`.
- Move code to `scripts/`.
- Reference, do not copy.
- Do not repeat global rules.
- Do not include every edge case; only frequent and dangerous ones.

## Final checklist

- [ ] `description` says what, when and keywords.
- [ ] ≤150 lines ideal; <500 lines hard.
- [ ] Outcome at the start.
- [ ] Procedure in the middle.
- [ ] Edge cases and verification at the end.
- [ ] References one level deep.
- [ ] Scripts for deterministic work.
- [ ] No duplicated `AGENTS.md`.
- [ ] No secrets.
