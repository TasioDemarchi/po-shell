# Estado, decisiones y criterios

## Estado actual

### v0.1 — funcional

- Kernel con tareas, fases, memoria, checks y reviews.
- Policy de paths y comandos.
- CLI.
- Extensión de Pi con 7 tools y 6 hooks.
- Skill `plain-workflow`.
- 101 tests (kernel 14, project 5, checks 4, indexer 9, context 7, directives 3, global 2, cross-project 4, delegate 8, subagent policy 3, tool defaults 2, policy 3, semantic 4, skills 2, search-cases 5, costs 5, backup 5, scratch 6, shell 10), todos pasando.
- Extensión validada en una sesión real de Pi.
- Launcher `plain`: **implementado** y validado en una sesión real de Pi.

### v0.2 — implementado

- `plain index`: indexador SQLite FTS5 de docs por sección y memorias.
- `context_search` / `context_get`: CLI + tools de Pi.
- Directivas de comportamiento (`plain remember`) e inyección al inicio.
- Memoria global real en `~/.plain/memory`.
- Búsqueda cross-project de memorias con `--all-projects`.
- Scopes: `project`, `global` (`personal` pendiente).
- Deduplicación y `topic_key` pendientes.

### v0.3 — implementado

- `plain_delegate` con `max_tokens`, `max_turns`, timeout y artefactos.
- Bench de 3 tareas en `bench/`.
- Gate de plan para tareas `risk: high`.
- Subagentes aislados: sin `AGENTS.md` global, sin tools de memoria/estado y sin escritura de `.md` ni del estado central.
- Router por rol: modelos fijos por rol en la config central.

### v0.4 — implementado

- `plain doctor` con diagnóstico de `agent dir`, `models.json`, providers, default model y `auth.json`.
- `plain checks suggest [--write]`.
- `plain projects prune` con backup en `~/.plain/trash/`.

### v0.5 — ledger de costo

- `plain costs` agrupa créditos por modelo, tarea, rol y proyecto.
- Tarifas Nan versionadas en `src/costs.js`; modelos sin tarifa quedan marcados.
- La extensión registra cada mensaje del orquestador y cada subagente.
- El reporte es por proyecto y aclara que no representa el saldo global de Nan.
- Perfiles de subagentes sigue pendiente.

## Estado del proyecto

### Hecho

- Kernel determinista: tareas, fases, evidencia, reviews y eventos.
- Estado central por proyecto en `~/.plain/projects/<id>/`; el repo solo guarda docs `.md`.
- Launcher `plain`, skills y protocolo.
- Policy de paths/comandos y gate de escritura.
- Checks, review congelado y hashes.
- Memoria de proyecto, global y cross-project.
- Directivas de comportamiento.
- Subagentes aislados con presupuesto, timeout y artefactos.
- Modelos fijos por rol; override manual.
- `plain doctor`, `plain checks suggest`, `plain projects`, `plain where`, `plain projects prune`.
- Skills incluidas: `plain-workflow`, `agents-md-authoring`, `skill-md-authoring` y `feature-doc`.
- Criterio de riesgo en tool, skill, `AGENTS.md` del proyecto y escalado en código.
- Memorias canónicas en SQLite; Markdown queda como mirror de auditoría.
- Snapshots operativos `state`, `feature` y `session`; memoria primero, feature doc como fuente precisa.
- Checkpoint automático antes/después de compactación; se reinyecta como contexto.
- Búsqueda híbrida: FTS + `qwen3-embedding` + `rerank`, con fallback exacto.
- 101 tests y bench de 3 tareas.

### v0.6 — recuperación

- `plain backup` guarda estado, snapshot SQLite, memoria global y bundle Git.
- `plain backup list` lista snapshots por proyecto.
- `plain restore` mueve el estado anterior a `~/.plain/trash` y requiere `--yes`.
- `plain integrity` valida tareas, eventos, hashes de reviews, SQLite y espejos de memoria.
- `plain integrity --fix` importa memorias Markdown faltantes sin pisar las existentes.
- Runbook completo en `docs/recovery.md`.

### v0.7 — scratch temporal

- El launcher crea `~/.plain/tmp/plain-XXXXXX/` por sesión y lo expone como `TMPDIR`, `PLAIN_TMP` y `PLAIN_SCRATCH_ID`.
- Cada subagente recibe `plain-sub-XXXXXX` debajo del scratch de la sesión; el padre lo borra.
- Ledger atómico en `~/.plain/tmp/ledger/`; barrido de procesos muertos con una hora de gracia.
- `plain scratch list` y `plain scratch clean [--force]`.
- `scratch-guard` bloquea tests que apunten `TMPDIR` dentro del repo.
- Política documentada en `docs/scratch.md`.

### v0.8 — arranque sin comandos previos

- `plain` crea el estado central automáticamente si falta.
- `plain` corre `plain integrity` antes de abrir el chat.
- Si hay errores de integridad, no abre Pi y muestra el detalle.
- Las advertencias reparables se arreglan con `fixIntegrity`; el resto se informa.
- `plain init` e `plain integrity` siguen disponibles para uso explícito.

### Pendiente

| Item | Descripción |
|---|---|
| Servidor MCP | Exponer el kernel a Claude Code/Codex y otros clientes. |
| Sandbox del SO | bubblewrap/seatbelt/contenedor + egress allowlist. |
| Evals del arnés | Set más amplio que el bench de 3 tareas. |
| Scope `personal` | Tercer scope además de `project` y `global`. |
| Deduplicación y `topic_key` | Evitar memorias repetidas y actualizar por tema. |
| `plain checks set "<comando>"` | Agregar checks sin editar JSON a mano. |
| Artefactos de scratch | Registrar clones/worktrees creados por la sesión y limpiarlos con confirmación. |
| Quarantine de subagentes | Token de inicio de proceso para no confundir PID reutilizado. |
| Guard de `TMPDIR` en bash | Detectar `TMPDIR=...` dentro del repo también en comandos, no solo en tests. |
| Scratch en Windows | Validar permisos, locks y rutas largas con más casos reales. |

### Pausado

| Item | Descripción | Por qué / cuándo retomar |
|---|---|---|
| Perfiles de subagentes | Formalizar `agents` con modelo, tools, presupuesto y timeout por rol. | Pausado por decisión. Retomar al volver a delegación. |
| `AGENTS.md` por subagente | Protocolo específico por rol, inyectado al hijo. | Pausado. Retomar junto con los perfiles. |
| Medición real ampliada | Repetir el bench y medir más tareas. | Pausado: con 3 pruebas hay base suficiente por ahora. Retomar si cambia una pieza grande. |

### Descartado

| Item | Descripción | Por qué |
|---|---|---|
| Router automático por fase | Cambiar modelo según `exploring/planned/implementing`. | Rompe cache y consistencia; se eligió modelo fijo para el orquestador. |
| `.plain` dentro del proyecto | Estado oculto en cada repo. | Se centralizó en `~/.plain/projects/<id>/`; el repo solo guarda `.md`. |
| Modelo frontera por defecto | Usar siempre un modelo grande. | La comparativa de NaN no justificó frontera para estas tareas. |

## Decisiones

- No hay ADRs. Las decisiones se guardan en memoria con What/Why/Where/Learned.
- Los docs describen el estado actual; la memoria acelera el retome con snapshots y guarda el recorrido durable.
- El índice se deriva de los docs y se puede reconstruir.
- La memoria es canónica en SQLite y se exporta a Markdown para auditoría.
- La búsqueda es una sola, sobre dos corpus.
- El formato para el modelo es compacto (etiquetas), no JSON ni Markdown pesado.
- Plain es un producto sobre Pi: provee launcher, kernel y extensión; no reescribe el loop ni la TUI.

## Criterios de éxito

- 20 tareas representativas ejecutadas con el arnés.
- Reducción medible de tokens por tarea frente a “leer todo”.
- Cero secretos guardados en memoria.
- Policy bloqueando los casos definidos sin falsos negativos conocidos.
- Review reproducible: mismo hash, mismo diff.
- Tests del kernel pasando en cada cambio.
- Un humano puede entender el proyecto leyendo `README.md`, `PROJECT.md` y `docs/` cuando haga falta.
