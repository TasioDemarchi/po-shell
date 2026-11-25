# Estado, decisiones y criterios

## Estado actual

### v0.1 — funcional

- Kernel con tareas, fases, memoria, checks y reviews.
- Policy de paths y comandos.
- CLI.
- Extensión de Pi con 9 tools y 6 hooks.
- Skill `po-shell-workflow`.
- 168 tests (kernel 19, project 11, checks 4, indexer 9, context 7, directives 3, global 2, cross-project 4, delegate 14, subagent policy 7, delegation 6, context guard 7, tool defaults 2, policy 10, destructive 8, confirm 5, semantic 4, skills 2, search-cases 5, costs 5, backup 5, scratch 6, shell 10, state env 2, install 11), todos pasando.
- Extensión validada en una sesión real de Pi.
- Launcher `po-shell`: **implementado** y validado en una sesión real de Pi.

### v0.2 — implementado

- `po-shell index`: indexador SQLite FTS5 de docs por sección y memorias.
- `context_search` / `context_get`: CLI + tools de Pi.
- Directivas de comportamiento (`po-shell remember`) e inyección al inicio.
- Memoria global real en `~/.po-shell/memory`.
- Búsqueda cross-project de memorias con `--all-projects`.
- Scopes: `project`, `global` (`personal` pendiente).
- Deduplicación y `topic_key` pendientes.

### v0.3 — implementado

- `po_shell_delegate` con `max_tokens`, `max_turns`, timeout y artefactos.
- Bench de 3 tareas en `bench/`.
- Gate de plan para tareas `risk: high`.
- Subagentes aislados: sin `AGENTS.md` global, sin tools de memoria/estado y sin escritura de `.md` ni del estado central.
- Router por rol: modelos fijos por rol en la config central.

### v0.4 — implementado

- `po-shell doctor` con diagnóstico de `agent dir`, `models.json`, providers, default model y `auth.json`.
- `po-shell checks suggest [--write]`.
- `po-shell projects prune` con backup en `~/.po-shell/trash/`.

### v0.5 — ledger de costo

- `po-shell costs` agrupa créditos por modelo, tarea, rol y proyecto.
- Tarifas Nan versionadas en `src/costs.js`; modelos sin tarifa quedan marcados.
- La extensión registra cada mensaje del orquestador y cada subagente.
- El reporte es por proyecto y aclara que no representa el saldo global de Nan.
- Perfiles de subagentes sigue pendiente.

## Estado del proyecto

### Hecho

- Kernel determinista: tareas, fases, evidencia, reviews y eventos.
- Estado central por proyecto en `~/.po-shell/projects/<id>/`; el repo solo guarda docs `.md`.
- Launcher `po-shell`, skills y protocolo.
- Policy de paths/comandos y gate de escritura.
- Checks, review congelado y hashes.
- Memoria de proyecto, global y cross-project.
- Directivas de comportamiento.
- Subagentes aislados con presupuesto, timeout y artefactos.
- Modelos fijos por rol; override manual.
- `po-shell doctor`, `po-shell checks suggest`, `po-shell projects`, `po-shell where`, `po-shell projects prune`.
- Skills incluidas: `po-shell-workflow`, `agents-md-authoring`, `skill-md-authoring` y `feature-doc`.
- Criterio de riesgo en tool, skill, `AGENTS.md` del proyecto y escalado en código.
- Memorias canónicas en SQLite; Markdown queda como mirror de auditoría.
- Snapshots operativos `state`, `feature` y `session`; memoria primero, feature doc como fuente precisa.
- Checkpoint automático antes/después de compactación; se reinyecta como contexto.
- Búsqueda híbrida: FTS + `qwen3-embedding` + `rerank`, con fallback exacto.
- 168 tests y bench de 3 tareas.
- Aislamiento de env en el kernel: un `env` explícito nunca escribe en el home real; `projects prune` también considera huérfano un estado cuyo root ya no existe.

### v0.6 — recuperación

- `po-shell backup` guarda estado, snapshot SQLite, memoria global y bundle Git.
- `po-shell backup list` lista snapshots por proyecto.
- `po-shell restore` mueve el estado anterior a `~/.po-shell/trash` y requiere `--yes`.
- `po-shell integrity` valida tareas, eventos, hashes de reviews, SQLite y espejos de memoria.
- `po-shell integrity --fix` importa memorias Markdown faltantes sin pisar las existentes.
- Runbook completo en `docs/recovery.md`.

### v0.7 — scratch temporal

- El launcher crea `~/.po-shell/tmp/po-shell-XXXXXX/` por sesión y lo expone como `TMPDIR`, `PO_SHELL_TMP` y `PO_SHELL_SCRATCH_ID`.
- Cada subagente recibe `po-shell-sub-XXXXXX` debajo del scratch de la sesión; el padre lo borra.
- Ledger atómico en `~/.po-shell/tmp/ledger/`; barrido de procesos muertos con una hora de gracia.
- `po-shell scratch list` y `po-shell scratch clean [--force]`.
- `scratch-guard` bloquea tests que apunten `TMPDIR` dentro del repo.
- Política documentada en `docs/scratch.md`.

### v0.8 — arranque sin comandos previos

- `po-shell` crea el estado central automáticamente si falta.
- `po-shell` corre `po-shell integrity` antes de abrir el chat.
- Si hay errores de integridad, no abre Pi y muestra el detalle.
- Las advertencias reparables se arreglan con `fixIntegrity`; el resto se informa.
- `po-shell init` e `po-shell integrity` siguen disponibles para uso explícito.
- `updateTask` ignora campos `undefined`, así un update parcial no borra fase, riesgo, scope ni next.
- Las tareas high-risk guardan un `plan` explícito; el diálogo de aprobación lo muestra y rechaza un plan vacío.

### v0.9 — instalador propio (alcance A)

- `doctor` y el instalador comparten `diagnostics()`: una sola definición de "puede arrancar".
- `scripts/install.mjs` verifica Node 22+, git, Pi, extensión, skills, protocolo y el bin en PATH; acepta `--json` y `--dry-run`; nunca instala nada.
- `postinstall` corre el verificador en modo silencioso y siempre sale 0: nunca rompe una instalación.
- `po-shell install` reporta qué falta y el comando exacto; no instala Node ni Pi por su cuenta.
- `po-shell update` y `po-shell uninstall` detectan npm, pnpm o `npm link`; muestran el comando y solo lo ejecutan con `--yes`.
- `po-shell uninstall` nunca toca `~/.po-shell`: imprime dónde vive el estado y sale.
- `scripts/install.sh` hace el bootstrap del checkout: valida Node 22+ y git, avisa si falta Pi, corre `npm link` y termina con `po-shell doctor`.
- 10 tests nuevos en `test/install.test.js`.

### v0.10 — identidad que no pierde estado

- `projectIdentity` adopta el directorio que ya existe para el mismo root cuando el id calculado no tiene estado. Agregar un remote ya no deja las tareas invisibles.
- La cache de identidad se indexa por home + root, así dos `PO_SHELL_HOME` no se pisan.
- 3 tests nuevos: adopción, no-adopción cuando el id calculado existe, y aislamiento entre homes.
- Procedimiento manual en `docs/recovery.md` (escenario 8) y regla en `docs/self-hosting.md`.

### v0.14 — guard de contexto

- El orquestador mide su propio contexto en cada `message_end` (`input + caché`) contra la ventana del modelo activo. Se guarda en `context.json` y se muestra en `po-shell status` y en `<po_shell_state>`.
- `contextGuard: { warnAt: 0.15, delegateAt: 0.3, enforce: false }`. Con `enforce: true`, pasar el umbral activa el gate de `delegate-writes` por medición, sin cambiar de perfil a mano.
- Los umbrales son fracciones de la ventana: el 15 % de 1M son 157k; el de 200k, 30k.
- Eventos `context.warn` / `context.delegate` al subir de nivel. 7 tests nuevos. Total 168.
- Medición de las corridas del experimento: pico de 16.8k (inline) a 79.4k (delegado roto), o sea 1,6 %–7,6 % de una ventana de 1M: el umbral no se tocó, y por eso el guard es seguro, no la palanca de costo.

### v0.13 — la mecánica de delegación que fallaba

Cuatro bugs que solo se ven delegando de verdad (los encontró la corrida B2 del experimento):

- `max_tokens` se comparaba contra el total del mensaje (input + caché + output): con 4.000, el prefijo cacheado del hijo ya lo superaba y moría en el turno uno. Ahora cuenta **output acumulado** y el tool lo dice.
- `po_shell_delegate` **nunca guardó un artefacto**: la meta usaba `subagentCost` antes de su `let` (TDZ) y un `catch` vacío lo tapaba. La meta se arma con `delegationMeta()` y un fallo se reporta como `artifact: fallo (...)`.
- El costo se atribuía a la tarea activa aunque estuviera `ready` o `delivered`: una sesión nueva le sumaba créditos a la anterior. `attributableTask()` solo atribuye a fases abiertas.
- `freezeReview` contaba `added/deleted` con `numstat`, que no ve archivos sin trackear: un diff de 300 líneas nuevas reportaba 0. Ahora suma las líneas de los untracked y `overLimit` funciona.

Verificado end-to-end: una delegación real con `max_tokens=2000` completó y guardó `agents/run-*/result.md`. 4 tests nuevos. Total 161.

### v0.12.2 — probar la rama sin tocar main

- `sh scripts/install.sh --alias po-shell-test` crea un segundo comando que corre ese checkout (esta rama o un worktree). Nunca corre `npm link`, así que el `po-shell` global sigue donde estaba.
- Sirve para dogfooding: `po-shell-test` arranca Pi con la extensión, skills y protocolo del checkout donde se creó el alias.
- El estado central es compartido entre checkouts del mismo repo: mismas tareas, memoria y reviews.
- 1 test nuevo (`--help` documenta el flag, opción desconocida falla, el script no enlaza la rama sobre main). Total 157.

### v0.12.1 — diálogos con título

- El selector de aprobación mostraba el plan completo (duplicado de la prosa) y sin título propio. Ahora muestra `Aprobar plan · <tarea>` y una línea: `plan_summary`, un campo nuevo de la tarea. El detalle queda en `plan` y en la respuesta del agente.
- La confirmación destructiva muestra qué va a pasar en palabras (`Permitir comando destructivo · borrado recursivo · build/`) y el comando como contexto; nunca la clave interna del guard (`rmRecursive`).
- `planApprovalTitle` y `destructiveTitle` son funciones puras en `src/confirm.js`, así que el texto de cada diálogo se testea sin UI.
- 2 tests nuevos. Total 156.

### v0.12 — delegación real y perfil full delegation

- Contratos por rol en `prompts/subagents/`: `explore`, `worker`, `reviewer`, `planner` (~30 líneas cada uno). El hijo recibe protocolo común + contrato del rol, condensados de los `.md` de gentle-shell.
- `worker` exige `surfaces`: el guard del hijo rechaza `write`/`edit` fuera y las escrituras por shell (`>`, `tee`, `sed -i`, `cp`/`mv`).
- El reporte del hijo entra capado (16 KiB, cabeza + cola + puntero al artefacto); un JSON nunca se corta.
- Perfil `delegation: inline | delegate-writes` como dato de la tarea, visible en `po-shell status` y en `<po_shell_state>`. En `delegate-writes` el kernel bloquea la escritura de código del padre y deja `docs/features/`, commits, checks y estado.
- Regla de exploración: área desconocida o tercera llamada de descubrimiento → `explorer` obligatorio.
- 14 tests nuevos (4 delegate, 3 subagente, 5 delegación, 2 de worktree). Total 154.

### v0.11 — guard léxico, rutas sensibles en bash y confirmación

- `src/destructive.js`: tokenizador propio en lugar de regex sobre el string. Segmentos reales, wrappers (`env`, `sudo`, `timeout`, `xargs`…), recursión acotada en `sh -c`, `eval`, `find -exec` y sustituciones. Reconoce `rm` recursivo, `find -delete`, git duro (`reset --hard`, `clean -f`, `push --force`, `branch -D`, `checkout --`), SQL destructivo y escrituras a dispositivo.
- `policy.guards`: cada operación destructiva tiene una clave estable con `allow`, `confirm` o `block`. Los `hard deny` (`rm -rf /`, `/.`, `/*`, `mkfs`, `dd of=/dev/…`) no se pueden confirmar nunca.
- Rutas sensibles dentro de comandos: `cat ~/.ssh/id_rsa`, `cat .env` y `curl -d @.env` ahora se bloquean igual que desde el tool de lectura.
- Confirmación con salida: `src/confirm.js` es UI-agnóstico (probado con fakes) y abre un selector *Permitir esta vez / Denegar* con el comando y sus targets; sin UI falla cerrado. Los subagentes no ejecutan ninguna forma destructiva.
- `policy.maxChangedLines` dejó de ser config muerta: se informa como aviso al congelar el review.
- 23 tests nuevos (8 destructive, 7 policy, 4 confirm, 1 subagente y casos de hard deny). Total 140.

### Pendiente

| Item | Descripción |
|---|---|
| Servidor MCP | Exponer el kernel a Claude Code/Codex y otros clientes. |
| Sandbox del SO | bubblewrap/seatbelt/contenedor + egress allowlist. |
| Evals del arnés | Set más amplio que el bench de 3 tareas. |
| Scope `personal` | Tercer scope además de `project` y `global`. |
| Deduplicación y `topic_key` | Evitar memorias repetidas y actualizar por tema. |
| `po-shell checks set "<comando>"` | Agregar checks sin editar JSON a mano. |
| Artefactos de scratch | Registrar clones/worktrees creados por la sesión y limpiarlos con confirmación. |
| Quarantine de subagentes | Token de inicio de proceso para no confundir PID reutilizado. |
| Guard de `TMPDIR` en bash | Detectar `TMPDIR=...` dentro del repo también en comandos, no solo en tests. |
| Portes de subagentes | Cap del reporte, presupuesto de silencio renovable, superficies de escritura y tool de estado. Análisis y costos en `docs/subagentes.md`. |
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
| `.po-shell` dentro del proyecto | Estado oculto en cada repo. | Se centralizó en `~/.po-shell/projects/<id>/`; el repo solo guarda `.md`. |
| Modelo frontera por defecto | Usar siempre un modelo grande. | La comparativa de NaN no justificó frontera para estas tareas. |

## Decisiones

- No hay ADRs. Las decisiones se guardan en memoria con What/Why/Where/Learned.
- Los docs describen el estado actual; la memoria acelera el retome con snapshots y guarda el recorrido durable.
- El índice se deriva de los docs y se puede reconstruir.
- La memoria es canónica en SQLite y se exporta a Markdown para auditoría.
- La búsqueda es una sola, sobre dos corpus.
- El formato para el modelo es compacto (etiquetas), no JSON ni Markdown pesado.
- po-shell es un producto sobre Pi: provee launcher, kernel y extensión; no reescribe el loop ni la TUI.

## Criterios de éxito

- 20 tareas representativas ejecutadas con el arnés.
- Reducción medible de tokens por tarea frente a “leer todo”.
- Cero secretos guardados en memoria.
- Policy bloqueando los casos definidos sin falsos negativos conocidos.
- Review reproducible: mismo hash, mismo diff.
- Tests del kernel pasando en cada cambio.
- Un humano puede entender el proyecto leyendo `README.md`, `PROJECT.md` y `docs/` cuando haga falta.
