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

## po-shell
- Before starting: `po_shell_status`.
- Large work: `po_shell_task new` with scope and out-of-scope.
- Before saying done: `po_shell_check`.
- Before risky delivery: `po_shell_review freeze`.
- Decisions and bugs: `po_shell_memory save` with What / Why / Where / Learned.

## Risky paths

Mark `risk: "high"` if the change touches:

- `src/auth/**` or permissions
- `migrations/**`
- payments/billing
- secrets or `.env`
- public contracts
