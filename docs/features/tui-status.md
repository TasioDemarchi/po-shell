---
type: feature
status: to-do
---

# Feature: TUI status line, panel and stats

Risk: medium

## Outcome

Que la terminal responda, sin scrollear y sin preguntar nada, cuatro cosas mientras
se trabaja con agentes: dónde estoy, cuánto está costando, cuánto contexto queda y
si lo que veo está verificado. El footer queda en **una línea**; lo que necesita
atención vive en un **panel que se puede apagar**, y el detalle vive en `/stats`.

No es una feature nueva de producto: es la superficie de lo que el kernel ya sabe.

## Pain

Hoy Pi pinta dos líneas más una de estados (`↑in ↓out Rcache Wcache CH% $cost
ctx%/window (auto) … model · thinking`). Muestra tokens crudos que no cambian
ninguna decisión, cobra en dólares cuando la suscripción se paga en créditos, y no
sabe nada de la tarea, de los sub-agentes ni del ledger de po-shell. Para saber
cuánto se gastó hay que correr `po-shell costs`; para saber la fase, `po-shell
status`. Con un plan de ~70 créditos, el número que más importa es el que no está.

## Constraints

- No se toca el TUI de Pi: solo `ctx.ui.setFooter`, `setWidget`, `registerShortcut`.
- Cero tokens para la UI: se arma de estado local, nunca de una llamada al modelo.
- Cero dependencias nuevas.
- El chrome va en inglés; el agente sigue respondiendo en español.
- Los números son estimaciones con tarifas publicadas: `~` cuando hay un modelo sin
  tarifa. Nunca se muestra "saldo restante": la API key de Nan no puede leer el pool
  de créditos, solo cuota de tokens por modelo.
- El panel no ocupa espacio cuando no hay nada que decir.

## Design

### Footer (siempre, una línea)

```text
~/dev/po-shell · main ±3 · 📋 ready · 18.6cr · ctx 12% · deepseek-v4-flash · low
```

| Segmento | Decisión que cambia | Fuente |
|---|---|---|
| `~/dev/po-shell` | en qué repo estás | `ctx.cwd` |
| `main ±3` | rama y archivos sucios | `footerData.getGitBranch()` + `git status --porcelain` (caché 2 s) |
| `📋 ready` | hay tarea activa y en qué fase está | `activeTask()` |
| `18.6cr` | si sigue valiendo la pena | usage de la sesión + ledger de hijos |
| `ctx 12%` | cuándo delegar o compactar | `ctx.getContextUsage()` (`?` tras compactar) |
| `deepseek-v4-flash · low` | por qué responde así y cuánto cuesta | `ctx.model` + `ctx.thinkingLevel` |

Cascada al achicar: primero se cae el path (queda el basename), después `±3`,
después el modelo (queda `flash`). Créditos y `ctx` son los últimos en irse.

### Panel (toggleable, 0–3 líneas arriba del editor)

```text
📋 guard-de-contexto-mwvfpt33 · ready · med · evidence 2 · next: review the frozen diff
🤖 worker 41s · 0.31cr     🤖 explorer 12s · 0.05cr
✓ 185/185 · review mwvis2b5 · 8 files uncommitted
```

- `📋` tarea completa: fase, riesgo, `next`, evidencia.
- `🤖` hijos vivos con elapsed y créditos; ticker de 1 s **solo** mientras corren.
- `✓` evidencia de checks, review congelado y si hay cambios sin commitear.

Modos: `/panel on|off|auto` y `ctrl+shift+p`. Persistido en `~/.po-shell/ui.json`
junto al modo minimal (`po-shell ui panel auto`).

`auto` (default) = **no existe** mientras todo va normal. Aparece con: un hijo
corriendo, la última evidencia en rojo, un plan `high` esperando aprobación, el
contexto sobre el umbral de delegación, o un review congelado sin commitear.

### `/stats` (bajo demanda)

```text
session 1h 42m · 14 turns · 96 tool calls · 2 failed
spent    18.6cr  (orchestrator 16.5 · subagents 2.1)
tokens   in 412k · out 38k · cache R 9.1M (98.1% hit) · W 0
models   deepseek-v4-flash  12 turns · 320k · 0.9cr
         deepseek-v4-pro     2 turns ·  130k · 15.6cr
task     guard-de-contexto · medium · evidence 2 · review a40d8d0e
```

### Qué queda afuera

`$` dólares, `R/W` de caché en el footer, `(auto)` del compactado, provider, nombre
de sesión, contadores de tools. Son diagnóstico, no decisión: van a `/stats`.

## Decisions

- **No hay sidebar real en la API de Pi.** `setWidget` da un panel horizontal arriba
  del editor, colapsable y sin internals. La sidebar vertical de gentle-shell se
  construye operando el árbol de layout privado de `pi-tui`
  (`Symbol.for("@earendil-works/pi-tui/layout-node")`, "experimental Pi 0.85.1
  internals"), solo en fullscreen y con breakpoint en 140 columnas: frágil y contra
  la regla de no reescribir el TUI. Se descarta.
- **El footer reemplaza al de Pi**, no lo complementa: si se agrega debajo, quedan
  tres líneas y se pierde el punto.
- **`auto` antes que `on`**: el panel aparece por anomalía, no por costumbre.

## Tasks

- [x] **Fase 0 — título en cada fila.** `TOOL_STYLE.label` + `formatCall` con el formato
      `icono · etiqueta · sujeto · meta`; tests de las seis etiquetas nuevas.
- [ ] **Fase 1 — footer de una línea.** `src/minimal-ui.js` (formato de la barra),
      `src/ui.js` (`ui.json` con `minimal|full`), extensión con `setFooter`.
      Incluye caché de `git status` y `~` para créditos incompletos.
      Créditos solo del orquestador: los da Pi por sesión, sin tocar el kernel.
- [ ] **Fase 2 — créditos de sesión con hijos.** `session_id` en `cost_events`
      (`ALTER TABLE` idempotente), que la extensión lo pase al registrar, y suma
      orquestador + hijos por sesión. Entrada `18.6cr` con desglose en el panel.
- [ ] **Fase 3 — panel y `/stats`.** Widget con modos `on|off|auto`, shortcut
      `ctrl+shift+p`, ticker solo con hijos vivos, `/stats` con el desglose por
      modelo y por rol.

## Follow-ups

### Cada fila necesita un título (fase 0, antes del footer)

Las filas de una línea quedaron bien, pero **comandos, `edit` y `write` no dicen qué son**: se
lee `docs/features/po-dots-mvp.md  +23 −15` y no se sabe si fue una lectura, una edición o una
escritura; el icono solo no alcanza cuando el emoji no renderiza o se corta el borde.

Cada fila pasa a `icono · etiqueta · sujeto · meta`, con la etiqueta en inglés (regla de chrome)
y en dim, para que el ojo barra por palabra:

```text
🐚 shell · cd ~/dev/po-dots && sed -n 158,182p …
✏ edit · docs/features/po-dots-mvp.md  +23 −15
📝 write · PROJECT.md  +6 −5
📖 read · src/kernel.js:11-15
🔍 search · "Falta la proactividad"  · 2 results
```

Etiquetas: `shell`, `edit`, `write`, `read`, `search` (grep/find), `list` (ls). Las tools de
po-shell ya llevan su palabra (`task`, `memory`, `check`, `review`, `ask`, `delegate`): se normaliza
el mismo formato para todas. `TOOL_STYLE` gana el campo `label` y `formatCall` lo antepone.

## State

Fase 0 implementada (2026-11-25): `TOOL_STYLE` lleva `label` en inglés y `formatCall`
devuelve `{ icon, tone, label, text, meta }`; la extensión pinta
`icono etiqueta · sujeto  meta` con la etiqueta en dim. Las tools de po-shell dejaron de
duplicar su palabra en el texto (`task · new · …` sale de `label` + `text`), y las que no
tienen sujeto (`check`, `status`) pintan solo `icono etiqueta`.

Las fases 1–3 siguen sin implementar. La fase 1 es la que más cambia la sensación; el panel
puede esperar sin dejar la TUI a medias.

## Log

- 2026-11-25: fase 0. Etiquetas `shell`, `edit`, `write`, `read`, `search` (grep/find), `list`
  (ls), `status`, `task`, `memory`, `check`, `review`, `ask`, `delegate`, `get` (context_get).
  Un tool desconocido degrada a `label: ""`: la fila queda `icono sujeto`, sin inventar palabra.
  Se descartó alinear las etiquetas con padding: `delegate` (8) obligaría a cuatro espacios
  muertos en todas las filas.

- 2026-11-25: propuesta escrita. Relevado: footer nativo de Pi (2 líneas + estados,
  con tokens, `$`, `ctx%`, modelo), barra de gentle-shell (branch+dirty, permiso,
  modelo·effort, gauge de ctx con headroom, costo, quota, jobs), y qué datos expone
  Pi a una extensión (`getContextUsage`, `sessionManager.getEntries`,
  `footerData.getGitBranch`, `ctx.model`, `ctx.thinkingLevel`).
