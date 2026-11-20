# Project

## Commands
- test (all): `<command>`
- test (one): `<command>`
- typecheck: `<command>`
- lint: `<command>`

## Conventions not obvious from code
- ...

## Gotchas
- ...

## Plain
- Before starting: `plain_status`.
- Large work: `plain_task new` with scope and out-of-scope.
- Before saying done: `plain_check`.
- Before risky delivery: `plain_review freeze`.
- Decisions and bugs: `plain_memory save` with What / Why / Where / Learned.

## Risky paths

Mark `risk: "high"` if the change touches:

- `src/auth/**` or permissions
- `migrations/**`
- payments/billing
- secrets or `.env`
- public contracts
