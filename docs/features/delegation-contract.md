---
type: feature
status: active
---

# Feature: delegation contract

Risk: high

## Outcome

Que delegar sea un contrato verificable, no una sugerencia: el orquestador decide y escribe los
documentos, los sub-agentes hacen una cosa cada uno con capacidades limitadas en runtime, cada
handoff se puede revisar sin creerle la palabra a nadie, y ningún camino permite escribir código
sin que el riesgo lo autorice.

## Pain

La primera delegación real gastó 3.64 créditos y volvió con una frase a medias y 152 líneas sin
cablear. El rol no era un límite (`role: explorer, tools: ["read","edit"]` producía un explorer que
escribía en cualquier lado), el reporte en kill era el último mensaje del asistente, el hijo leía
otros repos del home, y el perfil por defecto dejaba al orquestador editar `src/` sin ningún gate.

## Constraints

- Las reglas viven en código, no en prosa: si no se puede testear, no es una regla.
- Cero dependencias nuevas.
- El chrome de la TUI en inglés; el agente responde en español; el CLI y los docs en español.
- El humano decide lo irreversible: aprobación de riesgo alto, aislamiento, merge y entrega.
- Un hijo nunca publica: sin commit, push, deploy ni instalaciones.

## Design

### Tres roles, tres capacidades

| Rol | Lee | Ejecuta | Escribe | Web | Turnos / tiempo |
|---|---|---|---|---|---|
| `explorer` | repo, prefijos de `read_outside`, memoria del proyecto | no | no | sí | 16 / 420 s |
| `worker` | repo y su scratch | sí (checks autorizados) | solo `surfaces` | no | 40 / 900 s |
| `reviewer` | repo y su scratch | sí, en una copia del repo | no | no | 15 / 600 s |

`planner` no existe: el plan lo escribe el orquestador, que es el único con las palabras del usuario
y las decisiones ya tomadas.

La matriz vive en `src/subagent-roles.js` y se aplica dos veces: el padre valida la delegación antes
de lanzarla y el guard del hijo la vuelve a aplicar en `tool_call` (el hijo recibe su rol por
entorno, no confía en la lista de tools que le pasaron).

### La misión

`validateMission` la rechaza si no cumple el contrato: `done` para los tres roles, `build_test` para
el worker y el reviewer, `surfaces` para el worker. `feature_doc`, en riesgo medio o alto, es un
campo de la task que el kernel inyecta en `CONTEXT` sin que el padre tenga que acordarse.

`buildMission` la arma en secciones: MISSION, CONTEXT (archivos y comandos), EDIT SURFACES, DONE
WHEN, OUT OF SCOPE.

### El handoff

Si el hijo muere por turnos, presupuesto o tiempo, el padre recibe `partialReport`: estado con el
presupuesto, últimas notas de progreso, `git diff --stat` de lo que quedó sin commitear, y el aviso
de que `DONE WHEN` no se confirmó.

### Quién escribe qué

| Riesgo | Perfil | Código lo escribe | Aprobación |
|---|---|---|---|
| `low` | `inline` | el orquestador | ninguna |
| `medium` | `delegate-writes` | un worker | ninguna |
| `high` | `delegate-writes` | un worker | el plan, una vez |

Con `delegate-writes` el padre solo escribe `docs/features/`. Una tarea `high` sin plan aprobado no
puede delegar (`checkPolicy` bloquea `po_shell_delegate`): delegar es la única puerta al código, así
que ahí vive el gate.

### Aislamiento

`po-shell task isolation worktree` (o `po_shell_task action=isolation` con un `reason` de dos
líneas) le da al hijo un `git worktree` propio con rama `po-shell/<run>`. El árbol del padre no
cambia; mergear o descartar es del humano. El orquestador no puede habilitarlo.

### Documentos del proyecto

Tres archivos, tres preguntas. Todos los crea el harness o el orquestador: el humano no los pide ni
necesita saber que existen.

| Archivo | Responde | Quién lo crea | Idioma |
|---|---|---|---|
| `PROJECT.md` | qué es el proyecto, alcance, stack, restricciones y **estado actual** | scaffold en `init()` | inglés |
| `AGENTS.md` | comandos, convenciones no obvias, gotchas, rutas riesgosas | scaffold en `init()` | inglés |
| `docs/features/<slug>.md` | qué es esta rebanada, por qué, diseño, decisiones y unidades | el orquestador | encabezados en inglés, contenido en el idioma del proyecto |

Reglas del feature doc:

- Un doc por rebanada sustancial. No es derrame de `PROJECT.md` ni un formulario.
- Frontmatter: `type: feature` y `status: draft|active|done`. Nada más.
- **No guarda estado**: la fase, la evidencia y la aprobación viven en la task; el estado del
  proyecto en `PROJECT.md`. Tampoco guarda el número de task: el vínculo va en un solo sentido
  (la task apunta al doc con `feature_doc`).
- Las unidades llevan id (`U1`, `U2`…) y la misión del worker las nombra con `covers: U3`, así el
  doc dice *qué*, la task *con qué alcance aprobado* y el artefacto *quién hizo qué unidad*.
- `Tasks`, `State` y `Log` no se indexan (secciones mutables); el resto sí.

### El índice

`src/indexer.js` mantiene `docs` y `doc_chunks` en SQLite. `context_search` reindexa en cada
búsqueda comparando hash y mtime, así que un doc recién escrito aparece en la primera búsqueda.
`po-shell index [--rebuild]` lo fuerza.

## Units

- [x] **U1 — Matriz de roles en runtime.** Padre valida, hijo re-valida; `planner` eliminado.
- [x] **U2 — Misión estructurada y reporte parcial.** `buildMission`, `partialReport`, notas del hijo.
- [x] **U2b — Contrato como predicado del kernel.** `validateMission` fuera del adaptador.
- [x] **U3 — Reviewer que ejecuta.** Copia en scratch, comandos autorizados, veredicto por ítem,
      guard que impide commitear, publicar e instalar.
- [x] **U4 — Worktree opt-in por el humano.** `isolationCommand`, diálogo con `reason`, lectura del
      estado, aislamiento que el orquestador no puede habilitar.
- [x] **U5 — Perfil por riesgo y gate.** `low` inline, `medium`/`high` delegate-writes, y `high` sin
      plan aprobado no delega.
- [ ] **U6 — Documentos del proyecto en runtime.**
      - [ ] `src/scaffold.js`: `PROJECT.md` y `AGENTS.md` desde plantillas **en inglés**, idempotente,
            llamado desde `init()`; nunca pisa un archivo existente.
      - [ ] `feature_doc` en la task: validado al crear (existe, es `.md`), obligatorio en
            `medium`/`high`, inyectado por `buildMission` a worker y reviewer.
      - [ ] Gate de `AGENTS.md` por contenido: si los comandos siguen con `<command>`, avisar en la
            delegación que el contexto va incompleto, sin bloquear.
      - [ ] Explorer a 16 turnos / 420 s.
- [ ] **U7 — Memoria read-only para el explorer.**
      - [ ] Tool de búsqueda en la extensión del guard (ya cargada en el hijo), habilitada solo para
            `explorer`: `search` y `get`, scope del proyecto, nunca `all_projects`, nunca `save`.
- [ ] **U8 — Documentos: mudanza.**
      - [x] Matar `docs/status.md`: el estado quedó en `PROJECT.md` §7-9 y el backlog en este doc.
      - [ ] Actualizar referencias en `AGENTS.md`, `README.md` y `docs/architecture.md`.
      - [ ] Reescribir la parte de documentos del protocolo con este modelo.

## Decisions

- **El orquestador es el ingeniero.** No delega el plan: lo escribe, porque es el único que tiene
  las palabras del usuario y lo ya intentado.
- **Una regla que no está en código es una sugerencia.** Por eso la matriz, el contrato y el gate
  viven en `src/`, con tests, y el adaptador solo los llama.
- **El perfil sale del riesgo**, no de una elección: `low` se edita en el lugar, el resto se delega.
- **El reporte en kill no es la última frase.** Notas acumuladas, diff y pendiente explícito.
- **El aislamiento y el merge son del humano.** El padre reporta; no decide el blast radius.
- **El feature doc describe, no lleva estado.** Duplicar fase o evidencia creó tres fuentes de
  verdad y ninguna confiable.
- **Sin `planner`.** Un rol que produce planes sin el contexto del usuario es ceremonia.

## Out of scope

- Extensión web propia para el explorer (`web_search`/`fetch`): unidad aparte, porque agrega red,
  proveedor y sus propios límites.
- Merge automático de worktrees.
- Aprobaciones por tarea en riesgo bajo o medio.
