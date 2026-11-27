---
type: feature
status: active
---

# Feature: one rule for the frame — the top is the call, the footer is the outcome

Risk: medium

## Outcome

Cinco correcciones que son la misma regla: **la regla de arriba lleva la llamada y nada más; el pie
lleva el resultado y su costo.** Lo que se expande, se expande entero.

1. Con `ctrl+o` o un click, el cuerpo muestra **todo** lo que devolvió la tool, no tres líneas.
2. La pista de la derecha es `ctrl+o`, sin las palabras *expand* ni *collapse*.
3. La delegación muestra los créditos gastados, en el pie junto a los turnos y el tiempo.
4. El pie de un shell es `ok · 23.4s`, sin el texto de la salida. En un fallo, `fail · exit N · 1.2s`.
5. La memoria no repite la clave abajo: el pie dice `saved` o `not saved`.

## Pain

El pie del shell copiaba la última línea de la salida (`ok · 23.4s · check ok`): el lugar más caro de
la fila gastado en repetir el cuerpo, y encima cortado (`Descubrimiento: 3 llamadas sin delegar — el
skill pide un explor…`). La memoria hacía lo mismo con la clave que ya estaba arriba. Y el expandido
prometía información completa y entregaba tres líneas, así que `ctrl+o` no servía para lo único que
sirve: ver lo que se cortó.

## Design

### El cuerpo expandido

- `bodySource` recibe `expanded`. Colapsado queda igual que hoy: tres líneas, la cola para un shell
  exitoso y la cabeza para un fallo, más el `… +N lines`.
- Expandido devuelve todas las líneas no vacías del resultado; un `edit` devuelve todos sus hunks con
  `-`/`+`, no los primeros seis.
- Un techo de `FRAME_BODY_MAX = 400` líneas por seguridad: más que eso, `… +N lines`. No es una
  decisión estética, es que un volcado de 5.000 líneas en un `Text` congela la TUI.
- El ancho no cambia: cada línea se corta al interior del marco.

### La pista

- Un solo export `FRAME_HINT = "ctrl+o"`, igual en los dos modos. Se elimina
  `FRAME_HINT_EXPANDED`: no hay dos estados que nombrar, hay una tecla.

### El pie de cada tool

- **bash:** `ok · 23.4s`; en fallo `fail · exit N · 1.2s` (el código de salida es estado, no salida).
  El texto que hoy iba en el pie sigue disponible al expandir, y un fallo conserva sus dos primeras
  líneas de razón debajo del marco (`extra`), que es otro canal. Desde acá la cabeza del error ya no
  se gasta arriba, así que las razones empiezan en la primera línea.
- **po_shell_memory:** `saved` / `not saved`. La clave vive arriba, en la fila de la llamada.
- **po_shell_delegate:** `ok · 2.14cr · 37 turns · 3m16s`, leído de `details`. Se retira el costo de
  la regla de arriba (`delegationNote`): un dato del resultado no va en la fila de la llamada.

### Lo que no se toca

- El formato del marco, los sigilos y el `renderShell: "self"`.
- Las filas de `po_shell_task` y `po_shell_check`, que ya dicen estado.
- `ui full`, que sigue delegando en Pi.

## Units

- [x] **U1 — Cuerpo completo.** `bodySource` con `expanded`, techo `FRAME_BODY_MAX`, y el `edit` sin
      el recorte de seis líneas. (D1)
- [x] **U2 — La pista.** `FRAME_HINT = "ctrl+o"`, sin `FRAME_HINT_EXPANDED`. (D1)
- [x] **U3 — Los tres pies.** bash sin el texto de la salida, memoria con `saved`/`not saved`,
      delegación con créditos en el pie, y las razones de un fallo desde la primera línea. (D1)
- [x] **U4 — Tests y pty.** 359 tests verdes y tres sesiones en pty real con `capture-pane`: el marco
      con `ctrl+o`, el cuerpo expandido de `seq 1 20`, y un fallo con `fail · exit 2 · 30ms`. (D1)

## Out of scope

- Colorear la salida de un shell dentro del marco.
- Un visor con scroll propio: Pi ya scrollea el transcript.
- Cambiar el texto de los `details`: los créditos ya están ahí, solo cambian de lugar.

## Decisions

- D1 — La regla de arriba lleva la llamada y el pie el resultado: el expandido muestra el cuerpo completo (techo de 400 líneas), la pista es solo ctrl+o, y los créditos, el tiempo y el saved/not saved van al pie, nunca repetidos arriba.
