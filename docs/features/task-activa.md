---
type: feature
status: active
---

# Feature: the active task is the one you name

Risk: medium

## Outcome

Que «la tarea activa» deje de ser un puntero invisible. Nombrar una task por id la vuelve la
activa, y el estado muestra —en una línea fija— las otras tasks que siguen en curso. La evidencia
de `po_shell_check` y la review congelada dicen en qué task cayeron.

## Pain

Retomar U7 en una sesión nueva costó una ronda entera de evidencia falsa: `po_shell_task
action=phase id=#37` movió la fase de #37, pero `setActiveTask` solo se llama desde `createTask`.
Los checks se grabaron en #39, la review se congeló con el riesgo y el `feature_doc` de #39, y el
gate de `ready` rechazó la evidencia por vieja. El error fue silencioso: el bloque de estado seguía
mostrando #39 y nada avisaba de que había otra task en `implementing`.

## Design

Dos reglas, una de estado y una de visibilidad.

1. **Nombrar es trabajar, si el cambio se guarda.** `updateTask(cwd, id, patch)` con `id` explícito
   llama `setActiveTask` después de escribir el parche: si el parche se rechaza (fase inválida,
   `ready` sin evidencia, gate de `feature_doc`), el puntero queda donde estaba. Sin id, no se mueve.
   Un id inexistente sigue tirando el mismo error de siempre. Vale para todo camino que ya pasa por
   `updateTask` con id: `po_shell_task action=phase`, `update` y `decision`, el CLI y cualquier
   llamada del kernel.
2. **Lo que se ve.** `renderStatus` y `renderContext` agregan una línea cuando hay otras tasks en
   `implementing` o `checking`, con tope de tres para no crecer: `Otras en curso: #37
   implementing · #41 checking`. `runChecks` devuelve la task donde grabó y el tool `po_shell_check`
   lo dice en su texto: `Tarea: #37 · checking`.

Lo que no cambia: la evidencia sigue perteneciendo a una sola task activa —no se reparte— y el
`feature_doc` de la misión sigue saliendo de la task activa. La corrección es de atribución, no de
modelo de datos.

## Units

- [x] **U1 — El puntero sigue al id.** `updateTask` marca activa la task nombrada, solo si el parche
      se guardó; tests de los cuatro casos (con id, sin id, id inexistente, parche rechazado). (D1)
- [x] **U2 — La atribución se ve.** Línea de «otras en curso» en `renderStatus` y `renderContext`
      (tope tres, orden por número), y `runChecks` devolviendo `task` para que `po_shell_check` la
      imprima. Test: dos tasks, una `implementing` y otra activa; cinco tasks para el tope. (D1)

## Out of scope

- Repartir evidencia entre tasks o permitir varias activas a la vez.
- Mover el puntero por herencia (abrir una sesión en un repo con dos tasks en curso y adivinar).
- Cambios en `po_shell_delegate`: ya usa la task activa y hereda la corrección.

## Decisions

- D1 — La atribución se corrige en dos piezas: el id explícito en updateTask mueve la task activa, y el estado muestra las otras tasks en curso (piezas 1 + 2); se descarta dejar solo la visibilidad o una acción `use` explícita, porque el error silencioso se paga con evidencia mal atribuida.
