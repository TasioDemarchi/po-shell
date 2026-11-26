---
type: feature
status: done
---

# Feature: instalador propio (alcance A)

Risk: high

## Outcome

Instalar po-shell sin clonar y sin `npm link` como único camino:
`npm i -g po-shell` deja el paquete listo, el `postinstall` verifica el entorno,
y `po-shell install` dice exactamente qué falta. Para el checkout,
`sh scripts/install.sh` hace link y verificación en un paso.

## Pain

Hasta ahora la única instalación real era `npm link` desde un clone. `PROJECT.md`
prometía `npm i -g po-shell` y el paquete no estaba publicado ni se verificaba al
instalarse. El primer usuario que probaba el comando documentado chocaba con un
404, y nadie le decía si le faltaba Node, git o Pi.

## Constraints

- Cero dependencias de runtime: Node 22+ y git, nada más.
- El instalador no baja binarios, no pide credenciales y no escribe secretos.
- `postinstall` nunca puede romper una instalación: si falla, sale 0 igual.
- Nunca se borra el estado central (`~/.po-shell`) desde un comando del paquete.
- Linux y macOS primero; Windows best effort (usa `where`/`PATH`).

## Non-goals

- Wizard web en `127.0.0.1`, descarga de Node/pnpm (alcance B/C).
- Instaladores GUI o binarios por plataforma.
- Publicar en npm.
- Instalar Pi automáticamente por su cuenta.
- Borrar `~/.po-shell` en `uninstall`.

## Specs

- S1. `po-shell install [--json]` verifica Node 22+, git, Pi, extensión, skills,
  protocolo y el bin en PATH; imprime el comando exacto de lo que falta.
  Accept: sale 0 si no hay fallos duros, 1 si falta algo imprescindible.
  Check: `test/install.test.js`.
- S2. `node scripts/install.mjs --postinstall` nunca sale distinto de 0.
  Accept: con Pi ausente sigue en 0 y avisa por stderr.
  Check: `test/install.test.js`.
- S3. `po-shell update` y `po-shell uninstall` detectan si la instalación es
  npm, pnpm, `npm link` o inexistente; sin `--yes` solo muestran el comando.
  Accept: `--json` devuelve `method` y `plan`; `--yes` ejecuta el gestor detectado.
  Check: `test/install.test.js`.
- S4. `po-shell uninstall` nunca toca el estado central e imprime su ruta.
  Accept: el JSON no contiene rutas de `~/.po-shell` como objetivo de borrado.
  Check: `test/install.test.js`.
- S5. `sh scripts/install.sh [--no-link]` valida Node 22+, git y npm, avisa si
  falta Pi, corre `npm link` y termina con `po-shell doctor`.
  Accept: idempotente, sin `sudo`, sin `curl | sh`.
  Check: `sh -n scripts/install.sh` + corrida manual.

## Assumptions

- Pi se distribuye como paquete npm (`@earendil-works/pi-coding-agent`) o está en
  el `PATH`; si no, `PO_SHELL_PI_BIN` lo resuelve.
- Cuando el paquete se publique, `npm i -g po-shell` corre `postinstall` en el
  directorio del paquete, no en el repo del usuario.
- Si el usuario instaló con `npm link`, actualizar es `git pull` + `npm link`,
  no una descarga desde el registro.

## Decisions

- D1. El instalador verifica, no instala. Instalar Pi o cambiar de versión de
  Node es decisión del humano; el comando se imprime, no se ejecuta.
  Why: menos superficie, cero sorpresas y cero red.
  Rejected alternative: postinstall que instala Pi (lo hace gentle-shell).
- D2. `update`/`uninstall` son dry-run por defecto y ejecutan solo con `--yes`.
  Why: tocar la instalación global es una acción con blast radius.
  Rejected alternative: ejecutar directo y confiar en el prompt del gestor.
- D3. `uninstall` no purga estado ni con `--yes`.
  Why: el estado es del usuario, no del paquete; borrarlo es irreversible.
  Rejected alternative: `--purge-state` en esta entrega.
- D4. `doctor` y el instalador comparten `diagnostics()`.
  Why: una sola fuente de verdad sobre qué significa "puede arrancar".
  Rejected alternative: duplicar los chequeos en el instalador.

## Tasks

- [x] T1. Extraer `diagnostics()` de `doctor()` — S1, S5 — check: `npm run check`
- [x] T2. `src/install.js` + `scripts/install.mjs` — S1, S2 — check: `test/install.test.js`
- [x] T3. Comandos `install`, `update`, `uninstall` — S3, S4 — check: `test/install.test.js`
- [x] T4. `scripts/install.sh` — S5 — check: `sh -n` + corrida manual
- [x] T5. `postinstall` en `package.json` — S2 — check: `test/install.test.js`
- [x] T6. Docs (README, AGENTS.md, PROJECT.md) — S1..S5 — check: revisión

## State

- Active: none (listo para revisión y commit)
- Last check: `npm test` 117/117, `npm run check` OK, `po-shell integrity` OK
- Blocker: none
- Next: commit del humano (push es decisión humana)

## Log

- L1. "Quiero que este harness sea un instalador propio, como lo es Gentle-Shell
  `~/dev/gentle-shell`." — El análisis previo está en el vault
  (`Plain — diseño de mi arnés.md`) y en el repo.
- L2. Decisión humana: alcance A (mínimo), después de cerrar los hallazgos del
  renombre `Plain → po-shell`.
