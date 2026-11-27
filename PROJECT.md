---
status: confirmed
updated: 2026-11-25
source: conversation
---

# po-shell

Documento humano y de contexto del proyecto. El manual operativo del agente vive en `AGENTS.md`.

## 1. Objetivo

Un arnés determinista, simple y barato para agentes de código.

po-shell existe para que el trabajo de un agente sea **verificable**, no para que el modelo sea más inteligente. El modelo propone; el arnés guarda estado, aplica reglas, registra evidencia y congela lo que se revisa.

Objetivos concretos:

- Que el agente no pierda decisiones entre sesiones.
- Que no diga “listo” sin evidencia.
- Que las reglas críticas no dependan de que el modelo se porte bien.
- Que el review se haga sobre los bytes exactos que se entregan.
- Que el costo en tokens sea bajo por diseño.
- Que todo funcione local, sin servicios pagos ni telemetría.
- Que se inicie con un solo comando: `po-shell`.

## 2. No-objetivos

- **No** reemplazar a Pi. po-shell es un arnés sobre Pi; el loop del modelo sigue siendo de Pi.
- **No** competir con Gentle Shell en cantidad de features.
- **No** tener 17 agentes ni una TUI propia.
- **No** depender de una nube, una cuenta o una API de terceros.
- **No** ser un framework de orquestación genérico.
- **No** reemplazar tests, revisión humana ni criterio de ingeniería.
- **No** ser un sandbox del sistema operativo (todavía).
- **No** tener una UI visual en la primera etapa.
- **No** reescribir la TUI de Pi ni construir una terminal propia.
- **No** agregar otra base de datos mientras SQLite/FTS alcancen.
- **No** meter todas las memorias en el contexto.
- **No** leer todos los docs por defecto.

## 3. Usuarios

| Usuario | Qué necesita |
|---|---|
| **Desarrollador** (yo) | Trabajar con un agente sin perder control, evidencia ni tiempo |
| **Agente** | Saber qué tarea hay, qué está permitido, qué se aprendió y qué falta |
| **Colaborador futuro** | Entender el proyecto sin leer todo el código |

## 4. Casos de uso

- Iniciar una tarea y ver en qué fase está.
- Buscar una decisión o un error pasado antes de repetirlo.
- Correr checks y dejar evidencia.
- Congelar un diff y revisarlo sin que cambie debajo.
- Bloquear paths y comandos peligrosos antes de ejecutarlos.
- Delegar exploración o revisión a un subagente con contexto limpio.
- Guardar una regla de comportamiento sin editar `AGENTS.md`.

## 5. Restricciones

- **Presupuesto:** $0. Sin servicios pagos.
- **Runtime:** Node 22+; cero dependencias de runtime.
- **Instalación:** `sh scripts/install.sh` desde el checkout o `npm i -g po-shell` cuando el paquete esté publicado. El `postinstall` verifica el entorno y `po-shell install` reporta qué falta; `update`/`uninstall` detectan npm/pnpm/link y solo ejecutan con `--yes`. Pi se detecta en el `PATH` o se configura con `PO_SHELL_PI_BIN`.
- **Almacenamiento:** local; SQLite cuando haga falta, sin servidor. `node:sqlite` (experimental) o un binario chico si falta FTS5.
- **Adapter principal:** Pi. MCP y otros clientes, después.
- **Portabilidad:** Linux y macOS primero.
- **Privacidad:** sin telemetría; sin secretos en memoria.
- **Documentación:** `README.md`, `PROJECT.md` y `docs/`. `AGENTS.md` es solo un bootstrap para Pi; la fuente de verdad es este archivo.

## 6. Documentación

```text
README.md      qué es, cómo se instala, cómo se usa
PROJECT.md     este archivo: objetivo, alcance, usuarios, restricciones y estado
AGENTS.md      manual operativo del agente en este repo
docs/
  architecture.md                     arquitectura, componentes, memoria
  recovery.md                         backup, restore y runbook de recuperación
  scratch.md                          temporales, cleanup y límites
  self-hosting.md                     cómo usar po-shell para mejorar po-shell
  features/                           un archivo por feature sustancial
  agents-md-y-skill-md-investigacion.md  criterios para instrucciones de agentes
```

`AGENTS.md` es la fuente de verdad del comportamiento del agente en el repo. `PROJECT.md` es la fuente de verdad del proyecto para humanos. No dupliques secciones entre los dos.

## 7. Estado

El estado vive acá. No hay un documento de estado paralelo: cuando este archivo crezca, lo que sobre
se muda a `docs/features/` o a memoria, nunca a otro archivo de estado.

- **Fase:** v0.19 — el marco de las tools y el estado que avisa. El arnés es usable de punta a punta:
  tareas, memoria, checks, review congelado, backup y subagentes con `memory_search` y `web_fetch`.
- **Próximo paso:** pushear `main` (7 commits, ver *Estado del árbol*) y desbloquear las tasks `high`
  con la mejora del gate de `delivered` (ver § Pendiente). Después, si hace falta, la etapa 2 de la
  web: `web_search` con proveedor por env var.
- **Estado del árbol:** la rama ya se mergeó a `main` (fast-forward, sin merge commit) y `main` es lo
  que corre el `po-shell` del `PATH` por el symlink del worktree. Queda **sin pushear**: los commits
  posteriores a `origin/main`. El trabajo se hace en `/home/tachii/dev/po-shell-delegation` y
  `main` está checkouteado en `/home/tachii/dev/po-shell`.
- **Semántica de `delivered`:** una task entregada es una task **commiteada y lista para merge**, no
  mergeada. El merge, el push y el deploy siguen siendo del humano.
- **Documentos:** son del orquestador. `PROJECT.md`, `AGENTS.md`, `README.md` y `docs/features/`
  quedan escribibles en cualquier perfil; el código sigue yendo por un worker con superficies, y un
  hijo nunca escribe `.md`.
- **Riesgos abiertos:** el aislamiento por worktree todavía no se ejercitó en una sesión real; el
  índice se actualiza por búsqueda, no por escritura, así que un doc recién creado no aparece hasta
  la primera consulta; siete tasks `high` no se pueden cerrar porque el gate de `delivered` exige que
  la **última review del repo** sea de esa task, y hace días que la última es de otra.

### Hecho

Kernel, CLI, launcher, policy, checks, review congelado, memoria, directivas, ledger de costo,
`backup`/`restore`/`integrity` con runbook, scratch temporal por sesión y subagente, instalador
propio, identidad de proyecto por root, guard de contexto, estética minimalista (filas de dos líneas,
footer, panel, `/usage` y `/plan`) y delegación con contrato: matriz de roles en runtime, misión
estructurada, reporte parcial, reviewer que ejecuta, worktree opt-in, memoria read-only (`memory_search`)
y `web_fetch` acotado (solo destinos públicos, redirects re-validados, topes y presupuesto de egress).
La task activa es la que se nombra, y el estado muestra las otras en curso.

### Pendiente

| Item | Descripción |
|---|---|
| Por qué se agotan los turnos del worker | Dos misiones de hoy murieron en `turns_exceeded` (12 y 10 turnos). Hipótesis: el presupuesto es más chico que el piso de la misión — leer los archivos de contexto ya cuesta 8–10 turnos, y la misión pedía además editar y correr tests. Revisar los artefactos (`agents/run-mwyds1c3-9sew`, `run-mwyeqn1e-ms67`), medir turnos por fase (lectura, edición, verificación) y decidir: presupuesto mínimo derivado de `context_files` + `surfaces`, o un rol que lea una vez y escriba sin reexplorar. |
| Estrategia para que el worker cumpla | Con la evidencia de arriba, comparar: tasks atómicas (una unidad de conducta) + workers en paralelo, misiones con el parche ya escrito, o un worker que solo verifica. Medir créditos y turnos por estrategia en el mismo cambio. Ojo con el paralelismo: worktrees aislados y conflictos de `surfaces`. |
| Eliminar `pi-violeta` y variantes | Borrar el harness anterior por completo. Antes: inventario (repos, symlinks del `PATH`, extensiones, skills, memorias, sesiones, alias de shell, referencias en `AGENTS.md` globales), `po-shell backup` + `integrity`, y confirmación del humano. **Destructivo**: nunca tocar `~/.po-shell` ni el estado central. |
| Protocolo como `AGENTS.md` del arnés | Hoy `prompts/po-shell-protocol.md` se inyecta en todas las sesiones. Un `AGENTS.md` se lee del cwd, así que convertirlo en el `AGENTS.md` del repo **pierde cobertura** en otros proyectos. Decidir la relación: el protocolo manda y el `AGENTS.md` del repo agrega, o el protocolo deja de inyectarse. Evitar dos fuentes de verdad. |
| Revisar el `AGENTS.md` y los `SKILL.md` del arnés | Pasar `agents-md-authoring` y `skill-md-authoring` sobre los propios, medir con `scripts/measure-context.mjs`, buscar duplicación entre protocolo, skill y `AGENTS.md`, y mover a código lo que sea regla de verdad (los dos avisos de estado salieron de este agujero). |
| Modelos por rol: Qwen3.6 worker, GLM flash reviewer | Verificar disponibilidad real en el catálogo de Pi; si no está, elegir el más barato con tool-calling decente. Medir con una misión real (misma tarea, dos modelos): créditos, turnos, calidad. **El reviewer no puede ser más débil que el cambio que revisa.** |
| Delegación: ¿opcional o siempre obligatoria? | Hoy el perfil sale del riesgo (`inline` en `low`). Pregunta: ¿`delegate-writes` obligatorio siempre? A favor: el padre deja de gastar contexto explorando (pasó hoy: 13 puntos). En contra: ceremonia y créditos en cambios triviales. Decidir con números de una semana de tasks (perfil, créditos, contexto), no con impresión. Ver si el contador de descubrimiento alcanza como aviso. |
| Fix del falso positivo de `=>` | `shellWriteTargets` lee el `>` de una arrow function como redirección y el gate de `delegate-writes` bloquea un `bash` que no escribe nada. Hoy se esquivó escribiendo `function`. Una línea y su test. |
| Replanteo de delegación | Etapa 2 de la web, opcional: `web_search` con proveedor por env var. `web_fetch` ya está. Ver `docs/features/explorer-web.md`. |
| Gate de memoria en `delivered` | Hoy el aviso de memoria es un nudge. Si no alcanza, `delivered` en `medium`/`high` exige una memoria o un `D#` posterior a `implementing`. Ver `docs/features/state-nudges.md`. |
| Cierre de las tasks `high` | El gate de `delivered` exige que la última review del repo sea de esa task. Guardar la review en la task al congelar, y aceptar cualquier review de esa task al entregar. |
| Servidor MCP | Exponer el kernel a Claude Code/Codex y otros clientes. |
| Sandbox del SO | bubblewrap/seatbelt/contenedor + egress allowlist. |
| Evals del arnés | Set más amplio que el bench de 3 tareas. |
| Scope `personal` | Tercer scope además de `project` y `global`. |
| Deduplicación y `topic_key` | Evitar memorias repetidas y actualizar por tema. |
| `po-shell checks set "<comando>"` | Agregar checks sin editar JSON a mano. |
| Artefactos de scratch | Registrar worktrees creados por la sesión y limpiarlos con confirmación. |
| Quarantine de subagentes | Token de inicio de proceso para no confundir PID reutilizado. |
| Guard de `TMPDIR` en bash | Detectar `TMPDIR=...` dentro del repo también en comandos, no solo en tests. |
| Scratch en Windows | Validar permisos, locks y rutas largas con más casos reales. |

### Pausado

| Item | Descripción | Por qué / cuándo retomar |
|---|---|---|
| Medición real ampliada | Repetir el bench y medir más tareas. | Con 3 pruebas hay base suficiente. Retomar si cambia una pieza grande. |
| Portes de subagentes de gentle-shell | Cap de reporte, presupuesto de silencio renovable, tool de estado del hijo. | La matriz de roles, la misión y el worktree ya están; esto es lo que queda del análisis en `docs/subagentes.md`. |

### Descartado

| Item | Descripción | Por qué |
|---|---|---|
| Router automático por fase | Cambiar modelo según `exploring/planned/implementing`. | Rompe cache y consistencia; se eligió modelo fijo para el orquestador. |
| `.po-shell` dentro del proyecto | Estado oculto en cada repo. | Se centralizó en `~/.po-shell/projects/<id>/`; el repo solo guarda `.md`. |
| Modelo frontera por defecto | Usar siempre un modelo grande. | La comparativa de NaN no justificó frontera para estas tareas. |
| Rol `planner` | Un subagente que arma el plan. | No tiene las palabras del usuario ni lo ya intentado; el plan es del orquestador. |
| Aprobación por tarea | Pedir permiso para cada delegación. | La aprobación va donde está el riesgo: solo `high`, y sobre el plan. |

## 8. Decisiones de diseño

- **Sin ADRs.** Las decisiones se guardan en memoria con What/Why/Where/Learned; lo estructural se
  refleja en este archivo.
- **El índice se deriva** de los docs y se puede reconstruir; nunca es la fuente.
- **La memoria es canónica en SQLite** y se exporta a Markdown para auditoría.
- **Una sola búsqueda** sobre dos corpus (docs y memorias).
- **Formato compacto** para el modelo: etiquetas, no JSON ni Markdown pesado.
- **po-shell es un producto sobre Pi:** provee launcher, kernel y extensión; no reescribe el loop ni
  la TUI.

## 9. Criterios de éxito

- 20 tareas representativas ejecutadas con el arnés.
- Reducción medible de tokens por tarea frente a "leer todo".
- Cero secretos guardados en memoria.
- Policy bloqueando los casos definidos sin falsos negativos conocidos.
- Review reproducible: mismo hash, mismo diff.
- Tests del kernel pasando en cada cambio.
- Un humano puede entender el proyecto leyendo `README.md`, `PROJECT.md` y `docs/` cuando haga falta.
