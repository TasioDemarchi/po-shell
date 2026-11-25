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
atención vive en un **panel que se puede apagar**, y el detalle vive en `/usage` y `/plan`.

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
- Los números del footer y de `/usage` son estimaciones con tarifas publicadas: `~` cuando
  hay un modelo sin tarifa. El saldo real no sale de ahí: sale de `/plan`, que lee
  `GET /v1/usage` de Nan (verificado: devuelve `credits.allowance/used/remaining`,
  `period_start/end` y `totals.by_model`).
- El panel no ocupa espacio cuando no hay nada que decir.

## Design

### Footer (siempre, una línea)

```text
~/dev/po-shell · main ±3 · 📋 ready            18.6cr · ctx 12% · deepseek-v4-flash · low
```

Dos bloques: **proyecto a la izquierda** (path, rama y archivos sucios, fase de la tarea activa) y
**modelo a la derecha** (créditos de la sesión, contexto usado, modelo con nivel de thinking),
pegado al borde derecho. La separación se estira con la terminal y nunca baja de dos columnas, así
que el bloque del modelo no se mueve de lugar.

| Segmento | Decisión que cambia | Fuente |
|---|---|---|
| `~/dev/po-shell` | en qué repo estás | `ctx.cwd` |
| `main ±3` | rama y archivos sucios | `footerData.getGitBranch()` + `git status --porcelain` (caché 2 s) |
| `📋 ready` | hay tarea activa y en qué fase está | `activeTask()` |
| `18.6cr` | si sigue valiendo la pena | usage de la sesión + ledger de hijos |
| `ctx 12%` | cuándo delegar o compactar | `ctx.getContextUsage()` (`?` tras compactar) |
| `deepseek-v4-flash · low` | por qué responde así y cuánto cuesta | `ctx.model` + `ctx.thinkingLevel` |

Cascada al achicar, manteniendo los dos bloques: primero se compacta todo (`~/dev/po-shell` →
`po-shell`, `main ±3` → `main`, `deepseek-v4-flash · low` → `flash`), después se suelta el proyecto
(path, rama, fase), después el modelo, y recién si no entra ni el bloque de créditos se corta con
`…`. Créditos y `ctx` son los últimos en irse.

### Panel (toggleable, 0–3 líneas arriba del editor)

```text
📋 #12 · guard de contexto · ready · med · evidence 2 · next: review the frozen diff
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

### `/usage` y `/plan` (bajo demanda)

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
de sesión, contadores de tools. Son diagnóstico, no decisión: van a `/usage` y `/plan`.

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
- [x] **Fase 1 — footer de una línea.** `src/minimal-ui.js` (formato de la barra),
      `src/ui.js` (`ui.json` con `minimal|full`), extensión con `setFooter`.
      Incluye caché de `git status` y `~` para créditos incompletos.
      Créditos solo del orquestador: los da Pi por sesión, sin tocar el kernel.
- [x] **Fase 2 — créditos de sesión con hijos.** `session_id` en `cost_events`
      (`ALTER TABLE` idempotente), que la extensión lo pase al registrar, y suma
      orquestador + hijos por sesión. Entrada `18.6cr` con desglose en el panel.
- [x] **Fase 3 — panel y `/usage`.** Widget con modos `on|off|auto`, shortcut
      `ctrl+shift+p`, ticker solo con hijos vivos, `/usage` con el desglose por
      modelo y por rol, y `/plan` con la suscripción.
  - [x] Panel: modos `auto|on|off`, `ctrl+shift+p`, ticker con hijos vivos, tres filas sin
        comprimir (una fila que no entra se oculta), trigger por anomalía.
  - [x] `/usage` en el transcript: session, turns, tool calls, créditos con desglose por
        orquestador/hijos, tokens con hit de caché, y desglose por modelo y por tarea.

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

Fase 1 implementada (2026-11-25): `footerLine(parts, { width })` y los segmentos
(`homePath`, `gitLabel`, `taskLabel`, `creditLabel`, `contextLabel`, `modelLabel`,
`shortModel`) viven en `src/minimal-ui.js`; la extensión registra `ctx.ui.setFooter` en
modo minimal y lo devuelve a Pi (`setFooter(undefined)`) en `full`. `git status` se cachea
2 s, la lectura de la tarea 1 s, y los créditos salen de la suma de `recordCost` del
turno en `message_end` con `~` si faltó tarifa. El modo sigue siendo el
`minimal|full` de `~/.po-shell/ui.json`; no se agregó un tercer estado para el footer.

Fase 2 implementada (2026-11-25): `cost_events` gana `session_id` (+ índice
`cost_events_session`) con migración idempotente en `migrate()`; `recordCost` lo escribe y
deja `NULL` cuando el llamador no tiene sesión, `costSummary({ sessionId })` filtra. La
extensión pasa `ctx.sessionManager.getSessionId()` en los dos registros —orquestador en
`message_end`, hijo en `po_shell_delegate`— y suma los créditos del hijo a la misma
variable del footer, así que `18.6cr` ya incluye a los sub-agentes. El desglose por rol
sigue en `costSummary` y se mostrará en el panel de la fase 3.

Panel implementado (2026-11-25): `src/minimal-ui.js` arma las tres filas
(`panelRowTask`, `panelRowChildren`, `panelRowEvidence`, `panelRows`) y decide
(`shouldShowPanel`); `src/ui.js` guarda `panel: auto|on|off` junto al modo, así que
`po-shell ui panel`, `/panel` y `ctrl+shift+p` escriben lo mismo. La extensión mantiene
un registro en memoria de los hijos vivos (`po_shell_delegate` es sincrónico: se anota al
arrancar y se borra en el `finally`), y repinta cada segundo solo mientras hay alguno.
Las filas no se comprimen: la que no entra en el ancho se oculta entera.

Identidad de la tarea implementada (2026-11-25): dos nombres en vez de uno. `id` sigue
siendo la clave de máquina (archivo, topic de memoria, `taskId` de reviews y costos); `number`
es el handle humano (`#12`), secuencial y persistido en el JSON de la tarea, con contador en
`tasks/.seq` para que borrar la última no libere el número. Las tareas viejas se numeran una
vez, al primer `listTasks`, por `createdAt`. `getTask` acepta `12`, `#12` y el id exacto, así
que el humano puede decir "la 12" y el modelo no traduce nada a mano. Panel, `status`,
`po-shell task list/show` y la salida de `po_shell_task` muestran `#N · id · …`.

`/usage` implementado (2026-11-25): `src/stats.js` arma el bloque (`formatSpan`,
`formatTokensShort`, `cacheHit`, `sessionMetrics`, `statsLines`) y la extensión lo imprime con
`pi.appendEntry("po-shell-stats", …)` + `registerEntryRenderer`, que es TUI-only: preguntar los
números no gasta tokens. Los créditos salen de `costSummary({ sessionId })`, así que el
desglose orquestador/hijos usa el `session_id` de la fase 2. La fase 3 queda cerrada. Después se agregó `/plan` (suscripción) como comando aparte: `/usage`
es la sesión, `/plan` es la cuenta de Nan. Los dos se muestran en una ventana con borde
(`src/window.js`) y no como bloques en el transcript: `ctx.ui.custom` con `overlay: true`,
`render(width)` con el marco y `handleInput` cerrando con `esc` (`tui.select.cancel`) o `q`.

## Log

- 2026-11-25: fase 0. Etiquetas `shell`, `edit`, `write`, `read`, `search` (grep/find), `list`
  (ls), `status`, `task`, `memory`, `check`, `review`, `ask`, `delegate`, `get` (context_get).
  Un tool desconocido degrada a `label: ""`: la fila queda `icono sujeto`, sin inventar palabra.
  Se descartó alinear las etiquetas con padding: `delegate` (8) obligaría a cuatro espacios
  muertos en todas las filas. El icono de `edit` pasó a `✏️` (U+270F + VS16): el lápiz sin
  selector mide una celda y el resto dos, y ese era el espacio que se comía la fila.
- 2026-11-25: fase 1. La cascada del footer se probó con anchos reales (160/120/80/60/45/30) y
  el orden quedó: compactar path → `main` sin `±N` → familia del modelo, después soltar los
  segmentos sin `keep` (path, rama, tarea) y recién al final cortar con `…`. Créditos y `ctx`
  llevan `keep: true`. El ancho se mide en code points: alcanza para este chrome y no suma
  dependencias.
- 2026-11-25: el footer pasó a dos bloques, proyecto a la izquierda y modelo pegado al borde
  derecho. `footerLine` recibe `{ left, right }` y la cascada se mantiene: compactar los dos
  bloques, soltar el proyecto (path → rama → fase), después el modelo, y cortar con `…` solo si
  no entra el bloque de créditos. Cuando la izquierda desaparece el bloque del modelo queda
  alineado a la derecha, no salta a la izquierda. `textWidth` pasó a medir columnas, no code
  points: `📋` ocupa dos y con el conteo anterior la barra se desbordaba una columna.
- 2026-11-25: ventana. Un bloque en el transcript ensucia la conversación y queda ahí para
  siempre: cambió a `ctx.ui.custom` con `overlay: true`. El marco es puro (`windowFrame` en
  `src/window.js`): ancho fijo con filas truncadas, título en el borde superior y `esc close` en
  el pie. Mientras `/plan` espera a la API muestra `fetching…` y repinta con `tui.requestRender()`
  al llegar. Sin TUI (RPC) cae a `ctx.ui.notify` para no perder los números.
- 2026-11-25: `/plan`. `GET /v1/usage` es el único endpoint de la API de Nan que expone el pool:
  `/credits`, `/balance`, `/me`, `/subscription`, `/quota`, `/billing` responden 404. Devuelve
  `credits` (allowance/used/remaining/period_start/period_end/pack/frozen) y `totals.by_model`.
  El rango por defecto son los últimos 30 días y **no** coincide con el período de facturación:
  hay que pedir `?start_date=<period_start>&end_date=<hoy>` para que el total cierre con `used`.
  Son dos llamadas (la primera aprende el período), ~1.3 s cada una, cacheadas 60 s. La key se
  resuelve igual que en `semantic.js` (`NAN_API_KEY`, `PO_SHELL_SEMANTIC_API_KEY`, `auth.json`);
  nunca se imprime. El comando se separó de `/usage` porque una es la sesión y la otra la cuenta.
- 2026-11-25: `/usage`. Se usó `pi.appendEntry` + `registerEntryRenderer` y no `sendMessage`:
  el bloque no debe entrar al contexto del modelo, y `sendMessage` sí participa. `sessionMetrics`
  cuenta turnos por mensajes `assistant` y tool calls por mensajes `toolResult` (el único lugar que
  sabe si fallaron). El desglose por rol reusa `costSummary({ sessionId })` de la fase 2, sin
  volver a tocar SQLite. Ningún comando nuevo de CLI: `po-shell costs` ya cubre el caso sin sesión.
- 2026-11-25: identidad. El id (`slug-timestamp36`) no le dice nada al humano y ocupa media
  fila; el número sí. Se descartó derivarlo del orden de las tareas (cambiaría al borrar) y
  usarlo como clave de archivo (rompería memoria, reviews y costos históricos). El contador
  vive en `tasks/.seq` como número plano: un `.json` ahí lo leería `listTasks` como tarea.
  Numeración legacy perezosa en `listTasks` con una bandera que corta la recursión
  (`ensureTaskNumbers` lista tareas también).
- 2026-11-25: panel. El umbral de contexto no es un knob nuevo: se reusa
  `readContextPressure()`, que el kernel ya escribe en cada turno (`contextGuard`
  `warnAt 0.15` / `delegateAt 0.3`) y que ya mueve el gate de delegación. El trigger de
  `auto` es `children || lastCheckFailed || pendingHighPlan || contextLevel != ok || dirty > 0`.
  Como ensuciar el worktree es el estado normal mientras se trabaja, el panel queda visible
  la mayor parte de la sesión; si molesta, se acota a "dirty y tarea fuera de implementing".
  `reviewUncommitted` no existe como trigger propio: la fila de evidencia muestra el review y
  el dirty ya dispara.
- 2026-11-25: fase 2. La migración de `session_id` corre en `migrate()` y no en el `SCHEMA`:
  el índice `cost_events_session` sobre una base vieja fallaría si se creara junto al
  `CREATE TABLE`, porque la columna todavía no existe. Los eventos anteriores quedan con
  `session_id = NULL`: no hay forma honesta de atribuirlos a una sesión. Antes de tocar la
  base compartida: `po-shell integrity` (OK, 8 checks) y `po-shell backup`
  (`~/.po-shell/backups/f6832fc558ef09dd/2026-11-25T10-22-26-986Z`).
- 2026-11-25: propuesta escrita. Relevado: footer nativo de Pi (2 líneas + estados,
  con tokens, `$`, `ctx%`, modelo), barra de gentle-shell (branch+dirty, permiso,
  modelo·effort, gauge de ctx con headroom, costo, quota, jobs), y qué datos expone
  Pi a una extensión (`getContextUsage`, `sessionManager.getEntries`,
  `footerData.getGitBranch`, `ctx.model`, `ctx.thinkingLevel`).
