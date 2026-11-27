---
type: feature
status: active
---

# Feature: the mission a worker can actually finish

Risk: medium

## Outcome

Que un worker cierre su misión dentro del presupuesto que se le da, y que el presupuesto salga de la
misión y no del optimismo. Hoy el padre elige `max_turns` a mano y dos misiones de este proyecto
murieron en `turns_exceeded` sin haber empezado a editar.

## Pain

- `run-mwyds1c3-9sew`: `max_turns=12`, `turns_exceeded`. En el turno 9 la misión estaba
  funcionalmente hecha y verde (356 tests), con tres turnos por delante y dos comandos obligatorios más
  el reporte: cero margen. El turno 11 repitió la suite entera solo para buscar un nombre de subtest, y
  el 12 nunca llegó. El árbol quedó bien y el reporte no existe.
- `run-mwyeqn1e-ms67`: `max_turns=10`, `turns_exceeded` **sin una sola edición**. Diez turnos leyendo:
  el presupuesto no alcanzó ni para empezar.
- El control `run-mwyeryp3-0idc` hizo las dos ediciones en **dos turnos** y cerró sobrado, porque la
  misión traía el parche escrito línea por línea.
- Un tercer caso, nacido de este mismo análisis: el explorer que investigaba los turnos agotados murió
  en 16/16 leyendo archivos enteros. La misión no era grande; era difusa.

## Diagnosis

Medido sobre los `events.jsonl` de los tres runs originales (turno = `turn_start`…`turn_end`).

| run | turnos | antes de la 1ª edición | relecturas | verificación | resultado |
|---|---|---|---|---|---|
| `run-mwyds1c3-9sew` | 12 | 6 | 3 | 3 | verde, sin reporte |
| `run-mwyeqn1e-ms67` | 10 | **10 (nunca editó)** | 7 | 1 | nada |
| `run-mwyeryp3-0idc` | 10 de 12 | **1** | 1 | 5 | verde y reportado |

Cuatro causas, en orden de peso:

1. **Leer cuesta medio presupuesto.** Los `context_files` llegan como **rutas, nunca como contenido**
   (`src/delegate.js:52-59`) y `buildSubagentArgs` pasa `--no-context-files` (`src/delegate.js:107`),
   así que el hijo tiene que abrir todo él. El feature doc también llega como path
   (`src/kernel.js:495-501`). Seis turnos para empezar a editar, siete en el peor caso.
2. **El hijo no sabe cuántos turnos tiene.** `buildMission` no menciona el presupuesto y el env del
   spawn tampoco (`src/delegate.js:280-303`). Nadie puede administrar lo que no ve.
3. **El límite es un SIGTERM, sin turno de cierre** (`src/delegate.js:409-411`: incrementa, compara y
   mata). El trabajo hecho se pierde y el padre lee «turns_exceeded» sobre un árbol que podía estar
   verde.
4. **La misión difusa gasta turnos en averiguar.** El run 2 recibió una descripción en prosa del
   arreglo y una cláusula («no reestructures `summarize`») que lo mandó a leer `summarize` y
   `formatFrame`; el control recibió el parche y no leyó nada de más.

Agregado: el presupuesto que el padre pide **solo puede bajar** el techo del rol
(`src/subagent-roles.js:112-114`: `Math.min`), con techos de 16 turnos para `explorer`, 40 para
`worker`, 15 para `reviewer`. Y el reporte de éxito imprime el valor **crudo del padre**
(`extensions/po-shell.ts:1419`), así que un `max_turns` omitido se lee como `0` aunque rijan 40.

Dos defectos de legibilidad aparecidos en el camino: el `diffStat` del reporte parcial corre
`git diff --stat` en el cwd del padre (`extensions/po-shell.ts:1369-1377`), así que atribuye al hijo
lo que ya estaba sucio; y no hay validación de presupuesto contra el tamaño de la misión.


## Design

### Las palancas, con lo que cada una cuesta y ahorra

| Palanca | Cambia | Ahorra | Cuesta |
|---|---|---|---|
| **Contenido inlineado** | El kernel manda el contenido de los `context_files` (tope por archivo) además de la ruta | 5–7 turnos de lectura: la mitad del presupuesto | Tokens de prompt, que son baratos y se cachean |
| **Presupuesto visible** | La misión dice «tenés N turnos; reservá 2 para el reporte» y avisa al llegar a N−2 | Que el hijo no administre lo que no ve | Nada, es texto |
| **Turno de cierre** | Al llegar al techo, un último turno pide el reporte y recién ahí se mata | El trabajo deja de perderse (el run 1 estaba verde) | Un turno más de techo |
| **Misión con parche** | El padre diagnostica y manda el código exacto | El hijo edita en 1–2 turnos | Contexto y créditos del padre |
| **Explorer antes** | Una fase de exploración produce el parche; el worker lo aplica | El padre no quema contexto | Un run más (~1.3 cr) |
| **Paralelo por unidades** | Dos workers sobre superficies disjuntas a la vez | Pared de reloj | Doble costo de lectura; riesgo de conflicto |

### La estrategia recomendada

1. **El kernel no puede seguir matando sin pedir el reporte.** Es la corrección más barata y evita el
   único daño irreversible: trabajo verde convertido en `turns_exceeded` mudo.
2. **Inline de contenido: ataca la causa medida.** Seis de doce turnos fueron abrir archivos que el
   padre ya sabía cuáles eran.
3. **El presupuesto se deriva, no se adivina:** turnos = 2 × archivos de contexto + 2 por unidad de
   conducta + 3 de cierre, acotado por el techo del rol. Si el padre pide menos, el kernel avisa antes
   de lanzar en vez de descubrirlo en el reporte.
4. **Regla de misión, no de kernel:** si el padre ya sabe el parche, lo manda escrito; si no, manda
   primero un explorer. El paralelo queda para unidades disjuntas con el parche de cada una ya conocido.

### Lo que quedó implementado en el primer corte

- `buildMission` acepta `maxTurns` y escribe una sección `BUDGET (turns)` con el número y la
  instrucción de gastar el último turno en texto.
- En `runPiJson`, llegar al techo marca `turns_exceeded` pero no mata: el SIGTERM queda para el turno
  siguiente, así que el hijo gana exactamente un turno de cierre.
- El tool pasa el presupuesto **efectivo** (el que sale del `Math.min` con el techo del rol) y lo
  imprime en el reporte, en vez del valor crudo del padre.

Probado en real: un explorer con 3 turnos y un archivo de contexto contestó bien en 2. Uno con 1
el turno no alcanzó ni para leer, y ahí quedó a la vista que el reporte parcial sigue mostrando el
`git diff --stat` del padre como «changed so far» — este mismo cambio en vuelo apareció como del hijo.

### Lo que no se toca

- Los techos por rol ni el `Math.min`: el padre sigue sin poder pedir más de lo que el rol permite.
- La matriz de modelos.

## Units

- [x] **U1 — El diagnóstico.** Turnos por fase en los tres runs, medidos sobre los `events.jsonl`. (D1)
- [x] **U2 — Lo que el kernel ya hace.** Presupuestos por rol, `context_files` como rutas, techo por
      `Math.min`, corte por SIGTERM, `diffStat` del padre. (D1)
- [x] **U3 — La estrategia.** Propuesta comparada y decisión del humano: el turno de cierre primero.
      (D1)
- [x] **U4 — El turno de cierre.** Sección de presupuesto en la misión, un turno de gracia antes del
      SIGTERM, presupuesto efectivo en el reporte, y tres tests nuevos. (D1)
- [ ] **U5 — El texto del borde.** Con `maxTurns` 1 la sección dice «1 turns… after turn 0»: singular
      y caso extremo propio.
- [ ] **U6 — El diff atribuido.** El reporte parcial corre `git diff --stat` en el cwd del padre y
      presenta como del hijo lo que estaba sucio antes: sin aislamiento, no hay diff atribuible.

## Out of scope

- Cambiar la matriz de roles o los modelos.
- Paralelismo real con worktrees: se evalúa, no se implementa acá.

## Decisions

- D1 — El turno de cierre va primero: al llegar al techo el kernel no mata, la misión declara el presupuesto en turnos y el hijo gana un turno final para reportar. El inline de context_files y el presupuesto derivado quedan para después, medidos contra este cambio.
