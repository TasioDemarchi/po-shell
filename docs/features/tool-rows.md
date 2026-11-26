---
type: feature
status: active
---

# Feature: one frame per tool, collapsed and expanded

Risk: medium

## Outcome

Que cada acción del agente se lea como **un bloque**, no como un volcado: un marco con el sigilo de
la acción, el sujeto en una línea y el dato útil en el pie. Colapsado son dos líneas; expandido es el
mismo marco con el cuerpo adentro, recortado a tres líneas y con la cuenta de lo que quedó afuera.
Ningún carácter depende de una fuente que no esté: solo ASCII de una celda.

## Pain

El colapsado ya tenía marco, pero el pie quedaba vacío en `read`, `edit` y `write` —una regla muerta
de 90 caracteres—, los sigilos no decían nada (`read` era `=`, `ls` era `:`, `memory` era `*`) y
`grep`, `find` y `context_search` compartían `/`. Expandido era un volcado crudo de Pi
(`bash command="…"` y toda la salida), que es lo que el humano veía al abrir una tool.

La regla de `AGENTS.md` decía «collapsed is ours, expanded delegates to Pi». Se cambia (D1): el
expandido también es nuestro, con el mismo marco y un cuerpo acotado.

## Design

### Sigilos

Uno por familia, todos ASCII, un solo carácter, sin emoji ni iconos de fuente.

| acción | sigilo | etiqueta | acción | sigilo | etiqueta |
|---|---|---|---|---|---|
| shell | `$` | shell | task | `#` | task |
| read | `:` | read | memory | `=` | memory |
| write | `+` | write | check | `!` | check |
| edit | `~` | edit | ask | `?` | ask |
| search | `/` | search | review | `%` | review |
| list | `.` | list | delegate | `>` | delegate |
| get | `^` | get | web | `@` | web |

El resultado deja de usar `✓`/`✗`: `ok` y `fail`, en palabras.

### Colapsado: dos líneas, pie siempre útil

```
╭─ $ shell · npm test 2>&1 | tail -8 ────────────────────── 1.2s · ctrl+o expand ─╮
╰─ ok · 339 passed ────────────────────────────────────────────────────────────────╯
╭─ : read · src/kernel.js:101-140 ───────────────────────── 40 lines · ctrl+o ─────╮
╰─ no changes ──────────────────────────────────────────────────────────────────────╯
```

- `bash`: duración y la **última** línea relevante de la salida con éxito (el veredicto está al
  final), la primera cuando falla, o `exit N` si no hubo texto.
- `read`: cantidad de líneas del contenido leído.
- `edit`: `applied` en el pie; el `+N −M` vive arriba, en el sujeto, para no repetirlo.
- `write`: líneas escritas.
- `search`/`list`: cantidad de resultados.
- `delegate`: rol y estado; con créditos y turnos cuando terminó (U5).
- `web`: la URL (`web_fetch`) o la query (`web_search`) como sujeto, no el nombre de la tool.
- Error: la primera línea del error en el pie, sin recortar el resto del marco.

Nunca un pie vacío: si la tool no tiene nada que decir, el pie dice qué hizo.

### Expandido: el mismo marco, con cuerpo acotado

```
╭─ $ shell · npm test 2>&1 | tail -8 ─────────────────── ok · 1.2s · ctrl+o collapse ─╮
  pass 339
  fail 0
  duration 12.4s
  … +37 lines
╰──────────────────────────────────────────────────────────────────────────────────────╯
```

- Cuerpo de hasta **tres** líneas, cortadas al ancho del marco (sin wrap), y `… +N lines` solo si
  hubo más.
- `bash` con éxito muestra las **últimas** tres líneas (el veredicto está al final); con error, las
  primeras tres. `edit` muestra las primeras líneas del cambio con `-`/`+`. El resto de las tools, las
  primeras tres líneas del resultado.
- Sin barras laterales: el cuerpo va entre las dos reglas, como en gentle-shell.
- El hint dice `ctrl+o expand` colapsado y `ctrl+o collapse` expandido, en inglés como todo el chrome.

### La delegación dice lo que costó

Una delegación es la acción más cara del harness, y hoy su costo solo se ve expandiendo o leyendo el
reporte. Cuando el hijo termina, el marco lo muestra en la misma línea del hint:

```
╭─ > delegate · worker  Implementar U1 ──────────── 1.39 cr · ctrl+o expand ─╮
╰─ ok · 29 turns · 2m19s ───────────────────────────────────────────────────────╯
```

- Los créditos van arriba a la derecha, junto al hint; los turnos y el tiempo en el pie.
- Solo cuando terminó: mientras corre, el pie dice `running…` y no hay créditos inventados.
- El dato sale de `details` en el resultado de la tool, no de parsear el texto del reporte; sin costo
  calculable, el marco dice `no cost` en vez de un número falso.

### Lo que no se toca

- La separación entre bloques la sigue poniendo Pi: nosotros no agregamos líneas en blanco, porque
  duplicaría las que ya intercala.
- Los diálogos, toasts, footer, panel y `/usage` no cambian.
- `ui full` sigue mostrando la vista nativa de Pi: el marco es la estética de `minimal`.

## Units

- [x] **U1 — Sigilos y pie.** `TOOL_STYLE` con la tabla y `formatResult` devolviendo siempre algo útil
      por tool; `ok`/`fail` en vez de `✓`/`✗`. (D1)
- [x] **U2 — Cuerpo del expandido.** `formatFrame` acepta `expanded` y devuelve `body` (hasta tres
      líneas) y `overflow`; elección de líneas por tool (tail en bash ok, head en error, diff en
      edit). (D1)
- [x] **U3 — El renderer.** `extensions/po-shell.ts` dibuja el marco en los dos modos (colapsado y
      expandido) y solo delega a Pi en `ui full`; el hint cambia según el modo. El expandido dibuja el
      marco entero en el slot del resultado, para no duplicar la regla superior. (D1)
- [x] **U4 — Tests.** Sigilo por tool, pie nunca vacío, cuerpo de tres líneas con overflow correcto,
      ancho exacto del marco, bash ok/head vs error/tail, y que `ui full` no cambie. (D1)
- [x] **U5 — El costo de delegar.** `po_shell_delegate` devuelve `details` (rol, estado, turnos,
      créditos, ms, modelo, tokens, artefacto) y el marco los usa: créditos arriba a la derecha junto
      al hint, turnos y tiempo en el pie, `running…` mientras corre. Tests de los tres casos. (D2)

## Out of scope

- Themes nuevos, colores por tool más allá de los tonos que ya existen.
- Cambiar la vista de `ui full`.
- Imágenes, diffs completos o plegado por línea dentro del cuerpo.

## Decisions

- D1 — El expandido también es de po-shell: mismo marco con el cuerpo adentro, recortado a tres líneas y «… +N lines», y solo `ui full` delega en la TUI de Pi. Se cambia la regla de AGENTS.md.
- D2 — Una delegación muestra su costo en la fila: créditos arriba a la derecha junto al hint, turnos y tiempo en el pie, solo cuando terminó y leídos de details (no parseando el reporte); sin costo calculable dice «no cost».
