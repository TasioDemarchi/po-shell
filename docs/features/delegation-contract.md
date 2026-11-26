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

### El guard, en runtime

Independiente del rol, un hijo nunca publica ni instala: `git add|commit|push|pull|checkout|switch|
restore|reset|stash|clean|rebase|merge|tag` y `npm|pnpm|yarn install|add|publish`, `pip install` se
rechazan en `tool_call`. Las lecturas se confinan a `cwd` + su scratch + los prefijos de
`read_outside`; el scratch del hijo (que vive bajo `~/.po-shell/tmp/`) queda eximido de la regla de
estado central, porque si no el reviewer no puede ni escribir sus probes. El reviewer, además,
escribe **solo** dentro de su scratch: una redirección hacia el repo se rechaza.

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
cambia; mergear o descartar es del humano. El orquestador no puede habilitarlo, pero sí recomendarlo:
muestra el comando exacto (`isolationCommand(task)`) o abre el diálogo con `action=isolation`, que
exige un `reason` de dos líneas y explica qué protege. Después lee el resultado del estado, así que
continúa sin que el humano tenga que avisarle.

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
- [ ] **U10 — Decisiones con id.**
      - [x] `po_shell_task action=decision`: `D<n> — texto` en `## Decisions` del feature doc, el
            registro en el JSON de la tarea, y el eco con el total y las huérfanas.
      - [x] Bloque de estado: una línea fija con la regla, al lado de la tarea. Sin listas: crecerían
            con cada run.
      - [x] La misma regla en `Directives` del protocolo y en una sección propia de la skill.
      - [x] `scripts/check-docs.mjs` (`npm run docs:check`): referencias rotas, `## State`/`## Log` en
            feature docs, límite de 200 líneas, decisiones huérfanas (D1, D2). Con un ratchet
            (`KNOWN_DEBT`) que solo encoge: hoy son cinco ítems de deuda previa, no deuda nueva.
      - [x] `durable: true` escribe el `D#` y la memoria en una llamada, y el bloque de estado lleva las
            dos reglas con la memoria primero (D5): una decisión guardada solo como memoria ya está
            guardada; el `D#` existe para atar unidades.
      - [x] Captura al aceptar, no al proponer (D3): `po_shell_ask` lleva solo las opciones y una
            salida para seguir hablando; al elegir, la decisión se registra sola. `by: agent` marca
            las que tomó el orquestador bajo un plan delegado.
      - [x] Recorte del protocolo (290 → 153 líneas) y de `AGENTS.md` (223 → 132) para que la regla
            no quede enterrada (D2). El detalle operativo de delegación se mudó a
            `skills/po-shell-workflow/references/delegation.md`; el procedimiento de memoria se
            quedó en el protocolo, porque es el `AGENTS.md` global y no delega procedimiento a un
            doc de desarrollo (D4).
- [ ] **U9 — `AGENTS.md` por debajo de 200 líneas.** Hoy tiene 223: mover detalle a `docs/` o a una
      skill, sin comprimir hasta volverse ambiguo.
- [x] **U8 — Documentos: mudanza.**
      - [x] Matar el viejo doc de estado: su contenido quedó en `PROJECT.md` §7-9 y el backlog en este doc.
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
- **Las decisiones se capturan en el turno, con id.** Sin inbox ni contadores: una llamada a la tool
  escribe `D<n>` en el feature doc, que sobrevive al compact, y la regla vive en el bloque de estado
  con tamaño fijo. Una decisión sin unidad que la implemente se reporta como huérfana.
- **Sin `planner`.** Un rol que produce planes sin el contexto del usuario es ceremonia.
- **El perfil no se elige: `config.delegation` vale `"auto"`.** Un `"inline"` por defecto pisaba la
  regla del riesgo en cada `init`; `"auto"` significa "lo decide el riesgo" y un valor explícito en
  la tarea o el proyecto sigue ganando.
- **La web va en una extensión propia, no en un MCP.** Menos piezas y sin dependencias externas; la
  regla de rol es la misma: solo el explorer.
- **El diálogo de aislamiento exige un motivo.** Un botón que no se explica no es una decisión; sin
  `reason` de al menos 20 caracteres, el diálogo no abre.
- **Los documentos los crea el harness o el orquestador, nunca el humano.** Son ayudas para el
  agente: el humano no los pide y no necesita saber que existen; solo aprueba el alcance del
  proyecto la primera vez.
- D1 — El check de documentos destapó referencias a archivos inexistentes y un techo de 200 líneas que se llevaba tiempo violando; la deuda previa va en un ratchet que solo encoge.
- D2 — Recortar el protocolo (290 → ~150) y AGENTS.md (223 → ≤200) queda para después, en detalle: la regla ya vive en el bloque de estado, así que el recorte es higiene, no corrección.
- D3 — Las decisiones se confirman por po_shell_ask: la explicación va en la respuesta y el diálogo solo lleva las opciones más «seguir analizando»; aceptar captura el D# en el turno, sin esperar a que el humano lo repita.
- D4 — El protocolo es el AGENTS.md global del harness y no delega procedimiento a docs/architecture.md, que es documentación de desarrollo: el procedimiento de memoria vuelve al protocolo (153 líneas), el diseño del índice se queda en architecture.md.
- D5 — La memoria pesa más que el D#: si una decisión se guarda solo como memoria ya está guardada; el D# existe para atar unidades. durable: true escribe los dos en una llamada y las dos reglas viven en el bloque de estado, memoria primero.

## Out of scope

- Extensión web propia para el explorer (`web_search`/`fetch`): unidad aparte, porque agrega red,
  proveedor y sus propios límites.
- Merge automático de worktrees.
- Aprobaciones por tarea en riesgo bajo o medio.
