# Plain

**Un arnés determinista para agentes de código.**
No es un prompt, no es un kit de `.md`, no es un wrapper de chat: es un runtime con estado, políticas, evidencia y revisión congelada.

```
┌──────────────────────────────────────────────────────────────┐
│  Pi (hoy) · otros adapters después                          │
│  (el modelo propone, el loop ejecuta)                        │
└───────────────┬──────────────────────────────────────────────┘
                │ tools + hooks
┌───────────────▼──────────────────────────────────────────────┐
│  Plain (kernel + extensión)                                   │
│                                                              │
│  tasks      estado determinista del trabajo                  │
│  memory     conocimiento durable con búsqueda                │
│  policy     deny paths / deny commands / task gate           │
│  checks     tests, lint, typecheck → evidencia               │
│  reviews    candidato congelado + hash + riesgo              │
│  events     log append-only de todo                          │
└───────────────┬──────────────────────────────────────────────┘
                │
        ~/.plain/projects/<id>/ (estado central por proyecto)
```

## Qué resuelve

| Problema real | Cómo lo resuelve Plain |
|---|---|
| El agente olvida decisiones entre sesiones | `context_search` sobre docs + memorias |
| Dice “listo” sin probar nada | `plain_check` graba evidencia; el contexto recuerda que falta |
| Revisa un worktree que ya cambió | `plain_review freeze` congela bytes + hash |
| Toca secretos o comandos destructivos | `tool_call` gate determinista |
| Trabajo grande sin estado | task state machine (`authorized → … → delivered`) |
| No sabés qué hizo ni cuánto costó | `events.jsonl` append-only |
| El agente se auto-aprueba | review sobre candidato congelado + revisor aparte |

## Estado

v0.1: kernel, CLI, policy, checks, review, extensión de Pi y launcher `plain`.
El launcher está probado con un Pi simulado; falta validarlo en una sesión real.

## Instalación

Requisitos: Node 22+ y Pi.

```bash
cd plain
npm link                 # deja `plain` en el PATH
plain doctor              # verifica Node, Pi, git y archivos
plain                     # inicia el agente con Plain cargado
```

`plain` inicializa el estado central del proyecto en `~/.plain/projects/<id>/`.
El repo **no** recibe una carpeta `.plain/`: solo los `.md` del proyecto.

```text
~/.plain/
├── context.db                  memorias canónicas + índice de docs
├── memory/                     mirror Markdown de memorias globales
└── projects/<id>/
    ├── config.json             policy, checks, router de modelos
    ├── tasks/
    ├── memory/                 mirror Markdown de memorias del proyecto
    ├── reviews/
    ├── agents/
    └── events.jsonl
```

Podés cambiar la raíz con `PLAIN_HOME`.

Si no querés `npm link`, usá `node /ruta/a/plain/bin/plain.js`.

Para los subagentes, Plain ejecuta `pi`. Si no está en el `PATH` del proceso:

```bash
export PLAIN_PI_BIN=/ruta/al/binario/pi
```

El launcher limpia `PI_*` y `VIOLETA_*` heredados antes de abrir Pi. Así no reutiliza la sesión, el modelo ni el `agent dir` de otro harness. Si querés forzar un agent dir:

```bash
export PLAIN_PI_AGENT_DIR=/home/vos/.pi/agent
```

Para conservar todo el entorno heredado: `PLAIN_KEEP_PI_ENV=1`.

> [!note]
> `plain` carga la extensión explícitamente con `--extension`.
> Si además instalás el paquete con `pi install ./plain`, vas a cargarla dos veces.
> Elegí uno: `plain` (launcher) o `pi install` (uso desde un Pi normal).

Configurá tus checks en `~/.plain/projects/<id>/config.json`:

```json
{
  "checks": ["pnpm typecheck", "pnpm lint", "pnpm test"]
}
```

## Uso

```bash
plain                     # agente
plain shell -- --model X  # agente con argumentos para Pi
plain where               # muestra id, root y estado central del proyecto
plain projects            # lista proyectos con estado central (oculta huérfanos)
plain projects --all      # incluye directorios sin metadata
plain projects prune --dry-run  # muestra estados huérfanos
plain checks suggest      # propone checks según el stack
plain checks suggest --write    # los guarda en la config central
plain index               # indexa docs y memorias para búsqueda
plain context search "idempotencia"
plain context search "idempotencia" --project plain
plain ask "¿cómo manejamos uploads?" --project plain
plain context get "mem:arch-upload"
plain costs               # créditos por modelo, tarea y rol
plain costs --days 7      # últimos 7 días
plain costs --task <id>   # una tarea
plain costs --all-projects  # suma de todos los proyectos Plain
plain remember "Antes de refactorizar, mostrar un plan" --priority high --scope global
plain directives
plain status
plain task new "Agregar retries al upload" --risk medium --scope "upload handler"
plain task phase implementing
plain check
plain review freeze
plain memory save --title "Idempotencia" \
  --what "Reusar request id" \
  --why "Los retries duplicaban registros" \
  --where "internal/upload/handler.go" \
  --learned "El request id es estable entre retries" \
  --aliases "idempotencia, reintentos, idempotency" \
  --topic "architecture/uploads"
```

Dentro de Pi, el agente tiene:

- `plain_status`, `plain_task`, `plain_memory`, `plain_check`, `plain_review`, `plain_ask`, `plain_delegate`
- `context_search` y `context_get` sobre docs y memorias indexadas
- directivas de comportamiento inyectadas al inicio de cada sesión
- un hook `tool_call` que bloquea paths/comandos prohibidos
- un hook `before_agent_start` que inyecta el estado de la tarea en el contexto

## Skills incluidas

`plain` carga cuatro skills:

| Skill | Para qué |
|---|---|
| `plain-workflow` | Procedimiento operativo de Plain |
| `agents-md-authoring` | Escribir o revisar `AGENTS.md` |
| `skill-md-authoring` | Escribir o revisar `SKILL.md` |
| `feature-doc` | Crear y mantener `docs/features/<slug>.md` |

Las dos de autoría aplican los criterios de `docs/agents-md-y-skill-md-investigacion.md`.

## Feature docs

Trabajo chico: no se crea archivo.

Trabajo sustancial, riesgoso o multi-sesión:

```text
docs/features/<slug>.md
```

Un solo archivo por feature, con:

- resultado y dolor;
- límites y no-objetivos;
- specs y supuestos;
- decisiones;
- tareas atómicas;
- estado actual;
- log del pedido original.

El agente escribe el borrador, hace como máximo 3 preguntas y pide una sola aprobación antes de implementar.

Se indexan solo las secciones estables. `Tareas`, `Estado` y `Log` no se indexan. El feature doc es la fuente precisa; la memoria puede guardar un snapshot `state` o `feature` para retomar rápido.

## Idioma

- **Archivos del agente en inglés:** protocolo, skills, `AGENTS.md` y templates.
- **Texto para el usuario en español:** respuestas, README, `PROJECT.md` y docs humanos.
- **Feature docs:** estructura y headings en inglés; contenido, pedidos textuales, errores y copy de UI en el idioma del usuario.
- **Memorias:** un solo idioma por registro. En proyectos en español, se escriben en español y se buscan en español. Si la búsqueda no devuelve nada, reintentar con sinónimos en inglés.
- **Aliases:** cada memoria puede incluir 2–5 alias bilingües; el FTS exacto los indexa.
- **SQLite es la fuente:** las memorias viven en `~/.plain/context.db`; los `.md` son mirror de auditoría.
- **Snapshots:** `state`, `feature` y `session` son snapshots operativos; se actualizan por `topic`, no se acumulan.

## Memoria y reanudación

Tipos:

| Tipo | Qué guarda |
|---|---|
| `lesson` | bug, decisión, descubrimiento, patrón |
| `state` | tarea, fase, próximo paso, blocker |
| `feature` | resumen corto de una feature |
| `session` | checkpoint de compactación |
| `behavior` | regla del usuario |

Orden al retomar:

```text
1. Buscar memoria
2. Si el snapshot está fresco y completo, usarlo
3. Si no hay hit o falta detalle, leer el feature doc
4. Si no hay feature doc, leer código/docs
```

La memoria acelera; el feature doc manda.

El adapter guarda automáticamente un snapshot `state` al crear/actualizar una tarea y al correr checks.

Antes de compactar, guarda un checkpoint `session/current`; después de compactar lo vuelve a inyectar. Así se retoma sin releer todo.

## Búsqueda semántica

Plain usa la API de Nan:

```text
qwen3-embedding → embeddings
rerank            → reordenar candidatos
FTS exacto        → IDs, comandos y errores
```

Funciona como híbrido:

```text
1. FTS exacto / trigram
2. Embeddings de memorias y secciones de docs
3. Rerank de candidatos
4. Resultado final
```

- Si Nan no está disponible, vuelve a FTS exacto con variantes singular/plural y fallback OR.
- El primer search indexa embeddings lazy; después queda cacheado en SQLite.
- Para desactivar: `PLAIN_SEMANTIC=off` o `/semantic off`.
- `git push` está bloqueado por defecto; se habilita con `"allowPush": true` en la policy.
- Credenciales: `PLAIN_SEMANTIC_API_KEY` o `NAN_API_KEY`; también lee `auth.json` del agent dir.
- Variables: `PLAIN_EMBEDDING_MODEL`, `PLAIN_RERANK_MODEL`, `PLAIN_SEMANTIC_BASE_URL`.
- Smoke test semántico: `npm run test:semantic`.

Dentro de Pi:

```text
/semantic on
/semantic off
```

Sin argumentos muestra el estado. El cambio aplica a la sesión actual.

La regla completa vive en `prompts/plain-protocol.md`.

## Costos

Nan cobra en créditos, no en dólares. Plain calcula el costo con una tabla de tarifas por modelo y registra cada respuesta del agente y cada subagente.

```bash
plain costs
plain costs --days 7
plain costs --task <id> --json
```

Por defecto muestra solo el proyecto actual. `--all-projects` suma todos los proyectos Plain.

El reporte agrupa por modelo, tarea y rol. **No calcula el saldo de tu suscripción Nan**: solo muestra lo que consumió Plain. Si usás Nan en otros lados, ese consumo no aparece acá.

Si un modelo no tiene tarifa, el evento se registra con `0` créditos y el reporte lo marca como desconocido. Las tarifas viven en `src/costs.js`.

## Directivas de comportamiento

Para darle una regla al agente sin editar `AGENTS.md`:

```bash
plain remember "Antes de refactorizar, mostrar un plan y esperar aprobación" \
  --trigger "refactor, renombrar" \
  --priority high \
  --scope global
```

Se guarda como memoria `type: behavior` y se inyecta al inicio de cada sesión:

```xml
<plain_directives>
- [global, high] Antes de refactorizar, mostrar un plan y esperar aprobación (cuando: refactor, renombrar)
</plain_directives>
```

Para ver las directivas activas:

```bash
plain directives
plain directives --json
```

`--scope global` guarda la directiva en `~/.plain/memory/`, no en el proyecto.
Así se comparte entre todos tus proyectos.

```text
~/.plain/
├── context.db
└── memory/
    └── responder-en-espanol.md
```

Podés cambiar la ubicación con:

```bash
export PLAIN_HOME=/ruta/a/plain-home
```

IDs:

| Tipo | ID |
|---|---|
| Proyecto actual | `mem:arch-upload` |
| Global | `mem:global:responder-en-espanol` |
| Otro proyecto | `mem:project:<id>:bugfix-retries` |

Reglas:

- `project` gana sobre `global`;
- `high` gana sobre `medium` y `low`;
- `status: superseded` no se inyecta;
- máximo 10 directivas y ~800 caracteres.

## Buscar entre proyectos

Las memorias viven en una DB global. La búsqueda:

1. prioriza el proyecto actual;
2. si no encuentra, busca en el resto;
3. si el resultado es global, frena y pide validación.

También podés consultar otro proyecto registrado desde cualquier carpeta:

```bash
plain context search "retry duplicado" --project facturacion-api
plain ask "¿cómo manejamos uploads?" --project plain
```

```text
[memory] mem:project:a35f4a71:bugfix-retries · facturacion-api · bugfix · Retries duplicados
WARN memoria global: confirmá con el usuario antes de usarla.
```

Reglas:

- `--project` acepta nombre, id o root registrado.
- Si no hay proyecto actual, no se indexa el cwd a ciegas.
- `--all-projects` sigue siendo explícito para forzar todas las memorias.
- Solo cruza **memorias**, no specs ni docs de otros proyectos.
- Para traer el detalle:

```bash
plain context get "mem:project:<id>:bugfix-retries"
```

## Tareas de alto riesgo

Una tarea con `risk: "high"` nace con:

```json
"planApproved": false
```

El agente debe mostrar el plan y pedir aprobación humana con:

```text
plain_task action="approve"
```

Eso abre un selector:

```text
Aprobar plan
Rechazar plan
```

Hasta que se apruebe:

- no puede pasar a `implementing`;
- `edit`/`write` quedan bloqueados;
- los comandos de shell que mutan también quedan bloqueados.

## Delegación

`plain_delegate` lanza un subagente en otro proceso Pi con contexto limpio.

```json
{
  "role": "explorer",
  "task": "Mapeá el flujo de uploads",
  "max_tokens": 20000,
  "max_turns": 8,
  "timeout_seconds": 300
}
```

Devuelve:

```text
role: explorer
status: ok
turns: 3
usage: input=... output=... total=...
artifact: ~/.plain/projects/<id>/agents/run-.../result.md
```

Artefactos:

```text
~/.plain/projects/<id>/agents/run-.../
├── meta.json      rol, tarea, tools, usage, budget, status
├── result.md      salida final
└── events.jsonl   stream JSON de Pi (capado)
```

`max_tokens` cuenta el total reportado por Pi, incluido cache. Para explorar un repo mediano, 20k puede ser poco: usá 50k-80k o dejalo en 0.

El padre debe verificar el resultado; no confiar en él.

## Modelos

### Orquestador

El orquestador usa un **modelo fijo y capaz**. No hay router automático por fase.

Tiene que poder:

- interpretar pedidos ambiguos;
- detectar dudas y resolverlas con el humano;
- estructurar el trabajo;
- decidir cuándo delegar.

Según la comparativa de NaN:

| Prioridad | Modelo |
|---|---|
| Confiabilidad | DeepSeek V4 Flash |
| Costo/equilibrio | GLM 5.3 Flash |
| No hace falta | modelo frontera |

Se cambia manualmente con `/model` o `--model`.

### Subagentes

Cada rol tiene un modelo fijo en la config. El agente no lo cambia solo.
El humano puede reemplazarlo editando la config o pasando `model` en `plain_delegate`.

No hay cambio automático de modelo entre fases: eso rompería cache y consistencia.

## Router por rol

`plain_delegate` elige el modelo del rol desde `~/.plain/projects/<id>/config.json`:

```json
{
  "models": {
    "explorer": "nan/glm5.3-flash",
    "planner": "nan/deepseek-v4-flash",
    "worker": "nan/glm5.3-flash",
    "reviewer": "nan/deepseek-v4-flash"
  }
}
```

Si no hay modelo configurado, usa el modelo por defecto de Pi.

Sugerencia basada en la comparativa de NaN:

| Rol | Modelo | Motivo |
|---|---|---|
| `explorer` | GLM 5.3 Flash | Barato y parejo para leer/buscar |
| `planner` | DeepSeek V4 Flash | El más confiable sin palancas |
| `worker` | GLM 5.3 Flash | Perfecto en código y el más barato |
| `reviewer` | DeepSeek V4 Flash | Mejor agente/revisión sin ayudas |

No hace falta un modelo frontera para estas tareas.

## Aislamiento de subagentes

El subagente no hereda la conversación ni el `AGENTS.md` global del orquestador.
Se lanza con:

- `--no-context-files`: sin `AGENTS.md`/`CLAUDE.md`;
- `--no-extensions`, `--no-skills`, `--no-mcp`: sin contaminación global;
- un guard explícito de subagente;
- protocolo mínimo (`prompts/plain-subagent.md`);
- solo las tools del rol.

El subagente:

- no puede usar `plain_memory` ni tools de estado;
- no puede escribir ni modificar `.md`;
- no puede tocar el estado central (`~/.plain/`);
- sí puede leer, buscar y escribir código según su rol.

Si necesita contexto del proyecto, el orquestador debe pasarlo en la misión.

## Principios de diseño

1. **El modelo propone; el kernel dispone.** Las reglas que no admiten excepción no viven en un prompt.
2. **Estado central, no en el repo.** `~/.plain/projects/<id>/` es inspeccionable con `cat` y `jq`; el repo solo guarda docs `.md`.
3. **Una tarea, una fase, una próxima acción.** Nada de “estoy trabajando en varias cosas”.
4. **Evidencia o no está listo.** Un check que no corre no es un check.
5. **Revisión sobre bytes congelados.** Si cambia un byte, cambia el hash.
6. **Humano dueño del push.** El agente puede commitear para guardar estado; push, PR y deploy no se delegan.
7. **Delegar por razón, no por tamaño.** Exploración, paralelismo independiente, context backstop, verificador.
8. **Cero dependencias de runtime.** Solo Node y Git.

## Seguridad

La policy de Plain es **determinista pero no es un sandbox**. Bloquea paths y comandos conocidos; no impide que un binario arbitrario abra un socket. Para eso necesitás una barrera del sistema operativo:

- Linux: `bubblewrap` / contenedor
- macOS: `sandbox-exec`
- o correr todo el proceso en Docker/VM

Plain está diseñado para convivir con esa barrera, no para reemplazarla.

## Roadmap

| Versión | Qué agrega |
|---|---|
| **0.1** | Kernel + CLI + extensión Pi + launcher `plain` |
| **0.2** | `plain index` + `context_search` / `context_get` + directivas de comportamiento |
| **0.3** | `plain_delegate` con presupuesto y artefactos (hecho) |
| **0.4** | Onboarding: doctor de providers, checks suggest y projects prune (hecho) |
| **0.5** | Ledger de costo (hecho) + perfiles de subagentes |
| **0.6** | Servidor MCP para usar el kernel desde Claude Code/Codex |
| **0.7** | Sandbox integrado (bubblewrap/seatbelt) + egress allowlist |
| **0.8** | Evals del arnés: 20 tareas, medir aceptación/tiempo/tokens |

### Backlog

- `plain checks set "<comando>"`: agregar un check sin editar el JSON a mano.

## Estructura

```
plain/
├── README.md              qué es, cómo se instala, cómo se usa
├── AGENTS.md              manual operativo del agente en el repo
├── PROJECT.md             contexto humano y de proyecto: objetivo, alcance y estado
├── docs/architecture.md   arquitectura, componentes y memoria
├── docs/status.md         estado, pendientes, pausados y descartado
├── docs/agents-md-y-skill-md-investigacion.md  criterios para instrucciones de agentes
├── bin/plain.js            dispatcher: agente o CLI
├── src/kernel.js          estado, tasks, memory, checks, reviews
├── src/project.js         identidad de proyecto y estado central
├── src/indexer.js         índice SQLite FTS5 de docs y memorias
├── src/context.js         búsqueda y lectura de secciones/memorias
├── src/costs.js           tarifas Nan, créditos y ledger
├── src/policy.js          deny paths/commands, gate
├── src/cli.js             parser de comandos
├── src/shell.js           launcher: resuelve Pi y carga Plain
├── prompts/plain-protocol.md  protocolo estable del orquestador
├── extensions/plain.ts     tools + hooks para Pi
├── skills/plain-workflow/  procedimiento para el agente
├── skills/agents-md-authoring/  skill para escribir AGENTS.md
├── skills/skill-md-authoring/   skill para escribir SKILL.md
├── skills/feature-doc/          skill para crear docs/features/<slug>.md
├── docs/features/               documentos únicos por feature
├── templates/             AGENTS.md y TASK.md
└── test/                  kernel (14) + project (5) + checks (4) + indexer (9) + context (7) + directives (3) + global (2) + cross-project (4) + delegate (7) + subagent policy (3) + tool defaults (2) + policy (3) + semantic (4) + skills (2) + search-cases (5) + costs (5) + shell (7)
```

## Medir contexto

```bash
npm run measure -- --query "idempotencia" --limit 5 --get-limit 2
```

Compara leer todos los docs + memorias contra `context_search` + `context_get`.
Los tokens son una estimación gruesa (`chars / 4`), no un conteo del tokenizer del modelo.

En una prueba sintética de 15 docs + 30 memorias:

```text
Baseline: 29.774 chars ≈ 7.444 tokens
Hybrid:      868 chars ≈   217 tokens
Ahorro: 97,1%
```

> **Pendiente:** esto mide payload de contexto, no tokens reales de Pi/NaN.
> Falta la medición con 5 tareas reales: tokens, costo, tiempo y aceptación.

En el repo de Plain (8 docs):

```text
Baseline: 26.980 chars ≈ 6.745 tokens
Hybrid:    1.459 chars ≈   365 tokens
Ahorro: 94,6%
```

## Bench de 3 tareas

Escenario reproducible para medir el arnés:

```bash
node bench/prepare.mjs
```

Crea tres repos limpios:

```text
bench/work/01-small
bench/work/02-medium
bench/work/03-risky
```

Cada uno tiene su prompt en `bench/tasks/` y un test oculto de aceptación:

```bash
node bench/accept.mjs 01-small bench/work/01-small
```

Guía completa: `bench/README.md`.
Resultados: `bench/RESULTS.md`.

## Onboarding

Diagnóstico de Pi y providers:

```bash
plain doctor
```

Ahora muestra:

```text
agent dir, models.json, providers, defaultProvider/defaultModel, auth.json
```

Sugerencia de checks:

```bash
plain checks suggest
plain checks suggest --write
```

Detecta Node, Go, Rust, Python, Maven, Gradle, Makefile y justfile.
No ejecuta nada solo.

Limpieza de estados huérfanos:

```bash
plain projects prune --dry-run
plain projects prune --yes
```

Mueve los estados sin `project.json` a `~/.plain/trash/<fecha>/`, no los borra.

## Tests

```bash
npm test
npm run check
```

## Licencia

MIT.
