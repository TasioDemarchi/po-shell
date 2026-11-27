---
type: feature
status: active
---

# Feature: the state tells you to delegate and to remember

Risk: medium

## Outcome

Que dos reglas que hoy viven en prosa se vean **en el momento en que importan**, sin bloquear nada:

1. Cuando el orquestador lleva tres llamadas de descubrimiento sin delegar, el estado y el check lo
   dicen: el skill pide un `explorer`.
2. Antes de cerrar, el check dice cuántas memorias y decisiones se capturaron desde `implementing`;
   si no hay ninguna, lo dice en voz alta.

## Pain

El skill `po-shell-workflow` ya manda `explorer` a la tercera llamada de descubrimiento, y el
protocolo manda guardar el conocimiento en el turno en que se aprende. Las dos son prosa. En el
diagnóstico del marco de las tools se rompieron las dos: ~20 comandos de descubrimiento hechos por el
padre (13 puntos de contexto) y la lección guardada solo cuando el humano la pidió. Este repo tiene su
propia decisión escrita: *una regla que no está en código es una sugerencia*.

## Design

### El contador de descubrimiento

- `bumpDiscovery(cwd, toolName, task, env)` cuenta `read`, `grep`, `find`, `ls` y `bash` — lo que el
  padre hace para **encontrar**, no para arreglar. `edit`, `write`, `po_shell_delegate` y el resto de
  `po_shell_*` no suman.
- El contador vive en el estado central (`discovery.json`) con la clave `taskId + implementingAt`: al
  entrar de nuevo en `implementing` arranca en cero, sin que nadie lo limpie a mano.
- A partir de 3, `renderContext` agrega `discovery: N calls · delegate an explorer` y `renderStatus`
  agrega `Descubrimiento: N llamadas sin delegar — el skill pide un explorer`. Es información, no un
  gate: el padre decide.
- `runChecks` devuelve el conteo y `po_shell_check` imprime la misma línea al lado de la task.

### La memoria que falta al cerrar

- `knowledgeSince(cwd, task, env)` cuenta las memorias del proyecto indexadas después de
  `implementingAt` más las decisiones registradas en la task después de ese instante. **Excluye
  `state` y `session`**: el kernel escribe un snapshot `state/<task-id>` en cada cambio de fase, y si
  contara, el aviso nunca aparecería.
- `po_shell_check` y el eco de fase a `ready`/`delivered` imprimen
  `memoria: 0 desde implementing — si aprendiste la causa, guardala` cuando el conteo es cero y la
  task pasó por `implementing`. Con algo capturado, la línea no aparece.
- **No bloquea**: el gate de `delivered` sigue igual. Se evalúa subirlo a gate si el nudge no alcanza
  (decisión aparte, con su propio doc).

### Lo que no se toca

- El perfil de escritura sigue saliendo del riesgo. Esto no cambia quién escribe, solo qué se ve.
- Ni la skill ni el protocolo pierden su regla: el código la hace visible, no la reemplaza.

## Units

- [x] **U1 — El contador.** `src/discovery.js` con `bumpDiscovery` y `discoveryNote`; reset por
      `taskId + implementingAt`; umbral 3; línea en `renderContext` y `renderStatus`. (D1)
- [x] **U2 — El conteo de conocimiento.** `knowledgeSince` en `src/kernel.js` (memorias + decisiones
      posteriores a `implementingAt`, sin los snapshots `state`/`session`) y `runChecks`
      devolviéndolo. (D1)
- [x] **U3 — El eco.** `extensions/po-shell.ts`: `po_shell_check` imprime descubrimiento y memoria
      cuando corresponden; el eco de fase a `ready`/`delivered` imprime la línea de memoria. (D1)
- [x] **U4 — Tests.** Umbral y reset del contador, tools que no suman, `knowledgeSince` con y sin
      entradas (incluido el snapshot que no cuenta), y que las líneas desaparezcan cuando no hay nada
      que decir. (D1)

## Out of scope

- Bloquear `delivered` por falta de memoria (gate futuro).
- Cambiar el perfil por riesgo o auto-delegar sin que el padre lo decida.
- Contar llamadas del hijo: el contador es del orquestador.

## Decisions

- D1 — Las dos reglas de prosa (delegar el descubrimiento a la tercera llamada, guardar la memoria al cerrar) quedan como nudges determinísticos y visibles, no como gates: informan en el bloque de estado y en po_shell_check, y el gate de delivered no cambia.
