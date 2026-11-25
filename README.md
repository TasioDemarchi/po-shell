# po-shell

**Un arnés determinista para agentes de código.**
No es un prompt, no es un kit de `.md`, no es un wrapper de chat: es un runtime con estado, políticas, evidencia y revisión congelada.

```
┌──────────────────────────────────────────────────────────────┐
│  Pi (hoy) · otros adapters después                          │
│  (el modelo propone, el loop ejecuta)                        │
└───────────────┬──────────────────────────────────────────────┘
                │ tools + hooks
┌───────────────▼──────────────────────────────────────────────┐
│  po-shell (kernel + extensión)                                   │
│                                                              │
│  tasks      estado determinista del trabajo                  │
│  memory     conocimiento durable con búsqueda                │
│  policy     deny paths / deny commands / task gate           │
│  checks     tests, lint, typecheck → evidencia               │
│  reviews    candidato congelado + hash + riesgo              │
│  events     log append-only de todo                          │
└───────────────┬──────────────────────────────────────────────┘
                │
        ~/.po-shell/projects/<id>/ (estado central por proyecto)
```

## Qué resuelve

| Problema real | Cómo lo resuelve po-shell |
|---|---|
| El agente olvida decisiones entre sesiones | `context_search` sobre docs + memorias |
| Dice “listo” sin probar nada | `po_shell_check` graba evidencia; el contexto recuerda que falta |
| Revisa un worktree que ya cambió | `po_shell_review freeze` congela bytes + hash |
| Toca secretos o comandos destructivos | `tool_call` gate determinista |
| Trabajo grande sin estado | task state machine (`authorized → … → delivered`) |
| No sabés qué hizo ni cuánto costó | `events.jsonl` append-only |
| El agente se auto-aprueba | review sobre candidato congelado + revisor aparte |

## Estado

Estado: **alpha usable**. Kernel, CLI, policy, checks, review, memoria, subagentes, ledger de costo, backup/integrity y scratch temporal.
El launcher fue validado en sesiones reales; quedan pendientes MCP, sandbox y evals amplias.

## Instalación

Requisitos: Node 22+ y Pi.

Desde el checkout:

```bash
sh scripts/install.sh     # valida Node/Pi, corre npm link y po-shell doctor
```

O a mano:

```bash
cd po-shell
npm link                 # deja `po-shell` en el PATH
po-shell install         # verifica Node, Pi, extensión, skills y bin
po-shell doctor          # el detalle de cada chequeo
po-shell                 # inicia el agente con po-shell cargado
```

### Probar una rama sin tocar `main`

`--alias` crea un segundo comando que corre **este checkout**, sin re-apuntar el `po-shell` global:

```bash
cd ../po-shell-delegation          # tu rama o worktree
sh scripts/install.sh --alias po-shell-test
po-shell-test                      # sesión con el código de esta rama
po-shell-test doctor               # verifica qué checkout está usando
```

`--alias` nunca corre `npm link`: eso movería el `po-shell` de `main` a la rama. El comando nuevo
es un symlink a `bin/po-shell.js` de este directorio, así que sesión, extensión, skills y protocolo
salen de acá. Para borrarlo: `rm "$(dirname "$(command -v po-shell)")/po-shell-test"`.

El estado central es **compartido entre checkouts del mismo repo**: las tareas, la memoria y los
reviews son los mismos para `po-shell` y `po-shell-test`. No corras dos sesiones escribiendo estado a
la vez.

Cuando el paquete esté publicado:

```bash
npm i -g po-shell        # el postinstall verifica el entorno
po-shell install         # lo mismo, explícito y con --json
```

`po-shell install` no instala nada: reporta qué falta y el comando exacto
(por ejemplo `npm i -g @earendil-works/pi-coding-agent` si no hay Pi).
`po-shell update` y `po-shell uninstall` detectan si venís de npm, pnpm o
`npm link`, muestran el comando y solo lo ejecutan con `--yes`.
Desinstalar el paquete nunca borra tu estado: `~/.po-shell` queda intacto
y el comando imprime su ruta.

`po-shell` inicializa el estado central del proyecto en `~/.po-shell/projects/<id>/`.
El repo **no** recibe una carpeta `.po-shell/`: solo los `.md` del proyecto.

```text
~/.po-shell/
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

Podés cambiar la raíz con `PO_SHELL_HOME`.

Si no querés `npm link`, usá `node /ruta/a/po-shell/bin/po-shell.js`.

Para los subagentes, po-shell ejecuta `pi`. Si no está en el `PATH` del proceso:

```bash
export PO_SHELL_PI_BIN=/ruta/al/binario/pi
```

El launcher limpia `PI_*` y `VIOLETA_*` heredados antes de abrir Pi. Así no reutiliza la sesión, el modelo ni el `agent dir` de otro harness. Si querés forzar un agent dir:

```bash
export PO_SHELL_PI_AGENT_DIR=/home/vos/.pi/agent
```

Para conservar todo el entorno heredado: `PO_SHELL_KEEP_PI_ENV=1`.

> [!note]
> `po-shell` carga la extensión explícitamente con `--extension`.
> Si además instalás el paquete con `pi install ./po-shell`, vas a cargarla dos veces.
> Elegí uno: `po-shell` (launcher) o `pi install` (uso desde un Pi normal).

`po-shell` crea el estado central si falta y corre `po-shell integrity` antes de abrir Pi. `po-shell init` e `po-shell integrity` quedan como comandos explícitos, pero no son necesarios para arrancar.

Configurá tus checks en `~/.po-shell/projects/<id>/config.json`:

```json
{
  "checks": ["pnpm typecheck", "pnpm lint", "pnpm test"]
}
```

## Uso

```bash
po-shell                     # agente: crea estado y valida integridad solo
po-shell install             # verifica la instalación (no instala nada)
po-shell install --json      # el mismo reporte en JSON
po-shell update              # muestra el comando de actualización
po-shell update --yes        # lo ejecuta con el gestor detectado
po-shell uninstall           # muestra el comando de desinstalación
po-shell uninstall --yes     # desinstala el paquete; ~/.po-shell queda intacto
po-shell shell -- --model X  # agente con argumentos para Pi
po-shell where               # muestra id, root y estado central del proyecto
po-shell projects            # lista proyectos con estado central (oculta huérfanos)
po-shell projects --all      # incluye directorios sin metadata
po-shell projects prune --dry-run  # muestra estados huérfanos
po-shell checks suggest      # propone checks según el stack
po-shell checks suggest --write    # los guarda en la config central
po-shell index               # indexa docs y memorias para búsqueda
po-shell context search "idempotencia"
po-shell context search "idempotencia" --project po-shell
po-shell ask "¿cómo manejamos uploads?" --project po-shell
po-shell context get "mem:arch-upload"
po-shell backup              # snapshot de estado + SQLite + repo
po-shell backup list
po-shell restore <backup-dir> --yes
po-shell integrity           # tareas, eventos, reviews, SQLite y memoria
po-shell scratch list        # temporales de sesión y subagentes
po-shell scratch clean       # limpia temporales terminados
po-shell costs               # créditos por modelo, tarea y rol
po-shell costs --days 7      # últimos 7 días
po-shell costs --task <id>   # una tarea
po-shell costs --all-projects  # suma de todos los proyectos po-shell
po-shell remember "Antes de refactorizar, mostrar un plan" --priority high --scope global
po-shell directives
po-shell status
po-shell task new "Agregar retries al upload" --risk medium --scope "upload handler"
po-shell task phase implementing
po-shell check
po-shell review freeze
po-shell memory save --title "Idempotencia" \
  --what "Reusar request id" \
  --why "Los retries duplicaban registros" \
  --where "internal/upload/handler.go" \
  --learned "El request id es estable entre retries" \
  --aliases "idempotencia, reintentos, idempotency" \
  --topic "architecture/uploads"
```

Dentro de Pi, el agente tiene:

- `po_shell_status`, `po_shell_task`, `po_shell_memory`, `po_shell_check`, `po_shell_review`, `po_shell_ask`, `po_shell_delegate`
- `context_search` y `context_get` sobre docs y memorias indexadas
- directivas de comportamiento inyectadas al inicio de cada sesión
- un hook `tool_call` que bloquea paths/comandos prohibidos
- un hook `before_agent_start` que inyecta el estado de la tarea en el contexto

## Skills incluidas

`po-shell` carga cuatro skills:

| Skill | Para qué |
|---|---|
| `po-shell-workflow` | Procedimiento operativo de po-shell |
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
- **SQLite es la fuente:** las memorias viven en `~/.po-shell/context.db`; los `.md` son mirror de auditoría.
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

po-shell usa la API de Nan:

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
- Para desactivar: `PO_SHELL_SEMANTIC=off` o `/semantic off`.
- `git push` está bloqueado por defecto; se habilita con `"allowPush": true` en la policy.
- Credenciales: `PO_SHELL_SEMANTIC_API_KEY` o `NAN_API_KEY`; también lee `auth.json` del agent dir.
- Variables: `PO_SHELL_EMBEDDING_MODEL`, `PO_SHELL_RERANK_MODEL`, `PO_SHELL_SEMANTIC_BASE_URL`.
- Smoke test semántico: `npm run test:semantic`.

Dentro de Pi:

```text
/semantic on
/semantic off
```

Sin argumentos muestra el estado. El cambio aplica a la sesión actual.

La regla completa vive en `prompts/po-shell-protocol.md`.

## Costos

Nan cobra en créditos, no en dólares. po-shell calcula el costo con una tabla de tarifas por modelo y registra cada respuesta del agente y cada subagente.

```bash
po-shell costs
po-shell costs --days 7
po-shell costs --task <id> --json
```

Por defecto muestra solo el proyecto actual. `--all-projects` suma todos los proyectos po-shell.

El reporte agrupa por modelo, tarea y rol. **No calcula el saldo de tu suscripción Nan**: solo muestra lo que consumió po-shell. Si usás Nan en otros lados, ese consumo no aparece acá.

Si un modelo no tiene tarifa, el evento se registra con `0` créditos y el reporte lo marca como desconocido. Las tarifas viven en `src/costs.js`.

## Recuperación

Antes de una operación riesgosa:

```bash
po-shell backup
po-shell integrity
```

`po-shell backup` guarda el estado del proyecto, un snapshot de SQLite, la memoria global si existe y un bundle de Git. El runbook completo está en `docs/recovery.md`.

```bash
po-shell backup list
po-shell restore <backup-dir> --yes
po-shell integrity --fix
```

`restore` mueve el estado anterior a `~/.po-shell/trash/` y requiere `--yes`. `integrity --fix` solo importa memorias Markdown que falten en SQLite; no sobrescribe filas existentes.

## Scratch temporal

El agente no elige dónde poner scripts descartables. El launcher crea un directorio privado por sesión y lo pasa como `TMPDIR`:

```text
~/.po-shell/tmp/po-shell-XXXXXX/
```

Cada subagente recibe su propio `po-shell-sub-XXXXXX` debajo. El runtime limpia al cerrar y barre sesiones muertas al iniciar.

```bash
po-shell scratch list
po-shell scratch clean
po-shell scratch clean --force
```

Si un script deja de ser temporal, se promueve a `test/` o `scripts/`. La política completa está en `docs/scratch.md`.

## Directivas de comportamiento

Para darle una regla al agente sin editar `AGENTS.md`:

```bash
po-shell remember "Antes de refactorizar, mostrar un plan y esperar aprobación" \
  --trigger "refactor, renombrar" \
  --priority high \
  --scope global
```

Se guarda como memoria `type: behavior` y se inyecta al inicio de cada sesión:

```xml
<po_shell_directives>
- [global, high] Antes de refactorizar, mostrar un plan y esperar aprobación (cuando: refactor, renombrar)
</po_shell_directives>
```

Para ver las directivas activas:

```bash
po-shell directives
po-shell directives --json
```

`--scope global` guarda la directiva en `~/.po-shell/memory/`, no en el proyecto.
Así se comparte entre todos tus proyectos.

```text
~/.po-shell/
├── context.db
└── memory/
    └── responder-en-espanol.md
```

Podés cambiar la ubicación con:

```bash
export PO_SHELL_HOME=/ruta/a/po-shell-home
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
po-shell context search "retry duplicado" --project facturacion-api
po-shell ask "¿cómo manejamos uploads?" --project po-shell
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
po-shell context get "mem:project:<id>:bugfix-retries"
```

## Tareas de alto riesgo

Una tarea con `risk: "high"` nace con:

```json
"planApproved": false
```

El agente debe mostrar el plan y pedir aprobación humana con:

```text
po_shell_task action="approve"
```

Eso abre un selector que muestra **título y una línea de resumen**, no el plan entero:

```text
Aprobar plan · Delegación real
5 unidades: roles, superficies, cap, perfil y docs.
  Aprobar
  Rechazar
```

El detalle va en la respuesta del agente (`plan`); el selector lee `plan_summary`. Si falta, cae a la
primera línea del plan. Así el plan no se lee dos veces con el mismo nivel de detalle.

Hasta que se apruebe:

- no puede pasar a `implementing`;
- `edit`/`write` quedan bloqueados;
- los comandos de shell que mutan también quedan bloqueados.

## Delegación

`po_shell_delegate` lanza un subagente en otro proceso Pi con contexto limpio. Cada rol recibe un
contrato corto (`prompts/subagents/*.md`) además del protocolo común.

```json
{
  "role": "explorer",
  "task": "Mapeá el flujo de uploads",
  "max_tokens": 20000,
  "max_turns": 8,
  "timeout_seconds": 300
}
```

| Rol | Puede | No puede |
|---|---|---|
| `explorer` | leer, buscar, mapear | editar, mutar, arreglar |
| `planner` | leer y planificar | implementar |
| `worker` | editar **solo** las `surfaces` declaradas, correr los checks de la misión | commit, push, delegar, salir de sus superficies |
| `reviewer` | leer y probar por su cuenta | editar, repetir la suite del escritor |

Un `worker` sin `surfaces` no arranca: el guard del hijo rechaza `write`/`edit` fuera de ellas y
también las redirecciones de shell hacia afuera.

El reporte que entra al contexto del padre está **capado** (16 KiB por defecto, `reportMaxBytes` en
la config): cabeza + cola + el path del artefacto con el texto completo. Un reporte JSON nunca se
corta.

`max_tokens` cuenta **tokens de output acumulados** del hijo, no input ni caché: un hijo con un
prefijo cacheado grande no muere por presupuesto. `max_turns` sigue siendo la cantidad de turnos.
Cada delegación deja `agents/run-*/result.md` con el texto completo, sus eventos y la meta (rol,
superficies, presupuesto, créditos); si el artefacto no se puede guardar, el resultado dice
`artifact: fallo (...)` en vez de callarse.

### Perfil de delegación

La tarea lleva un perfil en su campo `delegation`, y el bloque `<po_shell_state>` muestra cuál está
activo. Se aplica en el kernel, no en el prompt:

- `inline` (default): implementa el padre.
- `delegate-writes`: el padre decide, explora, escribe `docs/features/` y commitea. Toda mutación de
  código va a un `worker` con `surfaces`; `edit`/`write` sobre código y las escrituras de shell dentro
  del repo quedan bloqueadas.

```bash
po_shell_task action=new title="..." risk=medium delegation=delegate-writes
```

`po-shell policy test --tool write --path src/app.js` refleja el perfil activo.

Devuelve:

```text
role: explorer
status: ok
turns: 3
usage: input=... output=... total=...
artifact: ~/.po-shell/projects/<id>/agents/run-.../result.md
```

Artefactos:

```text
~/.po-shell/projects/<id>/agents/run-.../
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
El humano puede reemplazarlo editando la config o pasando `model` en `po_shell_delegate`.

No hay cambio automático de modelo entre fases: eso rompería cache y consistencia.

## Router por rol

`po_shell_delegate` elige el modelo del rol desde `~/.po-shell/projects/<id>/config.json`:

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
- protocolo mínimo (`prompts/po-shell-subagent.md`);
- solo las tools del rol.

El subagente:

- no puede usar `po_shell_memory` ni tools de estado;
- no puede escribir ni modificar `.md`;
- no puede tocar el estado central (`~/.po-shell/`);
- sí puede leer, buscar y escribir código según su rol.

Si necesita contexto del proyecto, el orquestador debe pasarlo en la misión.

## Principios de diseño

1. **El modelo propone; el kernel dispone.** Las reglas que no admiten excepción no viven en un prompt.
2. **Estado central, no en el repo.** `~/.po-shell/projects/<id>/` es inspeccionable con `cat` y `jq`; el repo solo guarda docs `.md`.
3. **Una tarea, una fase, una próxima acción.** Nada de “estoy trabajando en varias cosas”.
4. **Evidencia o no está listo.** Un check que no corre no es un check.
5. **Revisión sobre bytes congelados.** Si cambia un byte, cambia el hash.
6. **Humano dueño del push.** El agente puede commitear para guardar estado; push, PR y deploy no se delegan.
7. **Delegar por razón, no por tamaño.** Exploración, paralelismo independiente, context backstop, verificador.
8. **Cero dependencias de runtime.** Solo Node y Git.

## Seguridad

La policy de po-shell es **determinista pero no es un sandbox**. Bloquea paths y comandos conocidos; no impide que un binario arbitrario abra un socket.

### Tres capas

1. **Paths sensibles** (`denyPaths`): globs sobre el input `path` de cualquier tool **y** sobre los argumentos de un comando de shell, así `cat ~/.ssh/id_rsa` o `curl -d @.env` no pasan.
2. **Guards por clave** (`policy.guards`): las operaciones destructivas se reconocen con un tokenizador propio (`src/destructive.js`), no con regex sobre el string. Cada clave vale `allow`, `confirm` o `block`:

```json
{ "policy": { "guards": { "rmRecursive": "confirm", "gitResetHard": "confirm", "gitPushForce": "block" } } }
```

Claves: `rmRecursive`, `findDelete`, `gitResetHard`, `gitCleanForce`, `gitCheckoutOverwrite`, `gitBranchDelete`, `gitRebase`, `gitStashDrop`, `gitPushForce`, `destructiveSql`, `diskWrite`.

3. **Confirmación con salida**: `confirm` abre un selector con título propio — `Permitir comando destructivo · <qué va a pasar> · <targets>` y el comando abajo — y las opciones *Permitir esta vez / Denegar*. Nunca muestra la clave interna del guard. Sin UI (print, JSON, subagente) se niega por defecto: fail closed. Un `hard deny` (borrado recursivo de `/`, `/dev` o la raíz de la home) no se puede confirmar nunca. Los subagentes no ejecutan ninguna forma destructiva, ni siquiera las confirmables.

Probá la policy sin ejecutar nada:

```bash
po-shell policy test --tool bash --command "rm -rf build/"   # CONFIRMARÍA (exit 3)
po-shell policy test --tool bash --command "cat .env"        # BLOQUEADO (exit 2)
po-shell policy test --tool write --path .env                # BLOQUEADO (exit 2)
```

`policy.maxChangedLines` se informa como aviso al congelar el review; no bloquea.

Sigue sin ser un sandbox. Para una barrera real:

- Linux: `bubblewrap` / contenedor
- macOS: `sandbox-exec`
- o correr todo el proceso en Docker/VM

po-shell está diseñado para convivir con esa barrera, no para reemplazarla.

## Roadmap

| Versión | Qué agrega |
|---|---|
| **0.1** | Kernel + CLI + extensión Pi + launcher `po-shell` |
| **0.2** | `po-shell index` + `context_search` / `context_get` + directivas de comportamiento |
| **0.3** | `po_shell_delegate` con presupuesto y artefactos (hecho) |
| **0.4** | Onboarding: doctor de providers, checks suggest y projects prune (hecho) |
| **0.5** | Ledger de costo (hecho) + perfiles de subagentes |
| **0.6** | Backup, restore e integrity (hecho) |
| **0.7** | Scratch temporal de sesión y subagentes (hecho) |
| **0.8** | Arranque automático sin `po-shell init` (hecho) |
| **0.9** | Servidor MCP para usar el kernel desde Claude Code/Codex |
| **1.0** | Sandbox integrado + evals amplias |

### Backlog

- `po-shell checks set "<comando>"`: agregar un check sin editar el JSON a mano.

## Estructura

```
po-shell/
├── README.md              qué es, cómo se instala, cómo se usa
├── AGENTS.md              manual operativo del agente en el repo
├── PROJECT.md             contexto humano y de proyecto: objetivo, alcance y estado
├── docs/architecture.md   arquitectura, componentes y memoria
├── docs/recovery.md       backup, restore y runbook de recuperación
├── docs/scratch.md        política de temporales y cleanup
├── docs/self-hosting.md   cómo usar po-shell para mejorar po-shell
├── docs/status.md         estado, pendientes, pausados y descartado
├── docs/agents-md-y-skill-md-investigacion.md  criterios para instrucciones de agentes
├── bin/po-shell.js            dispatcher: agente o CLI
├── src/kernel.js          estado, tasks, memory, checks, reviews
├── src/project.js         identidad de proyecto y estado central
├── src/indexer.js         índice SQLite FTS5 de docs y memorias
├── src/context.js         búsqueda y lectura de secciones/memorias
├── src/backup.js          backup, restore e integrity
├── src/scratch.js         scratch de sesión, subagentes y ledger
├── src/scratch-guard.js   bloqueo de TMPDIR dentro del repo
├── src/costs.js           tarifas Nan, créditos y ledger
├── src/policy.js          deny paths/commands, gate
├── src/cli.js             parser de comandos
├── src/shell.js           launcher: resuelve Pi y carga po-shell
├── prompts/po-shell-protocol.md  protocolo estable del orquestador
├── extensions/po-shell.ts     tools + hooks para Pi
├── skills/po-shell-workflow/  procedimiento para el agente
├── skills/agents-md-authoring/  skill para escribir AGENTS.md
├── skills/skill-md-authoring/   skill para escribir SKILL.md
├── skills/feature-doc/          skill para crear docs/features/<slug>.md
├── docs/features/               documentos únicos por feature
├── templates/             AGENTS.md, PROJECT.md y TASK.md
└── test/                  kernel (16) + project (5) + checks (4) + indexer (9) + context (7) + directives (3) + global (2) + cross-project (4) + delegate (8) + subagent policy (3) + tool defaults (2) + policy (3) + semantic (4) + skills (2) + search-cases (5) + costs (5) + backup (5) + scratch (6) + shell (10)
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

En el repo de po-shell (8 docs):

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
po-shell doctor
```

Ahora muestra:

```text
agent dir, models.json, providers, defaultProvider/defaultModel, auth.json
```

Sugerencia de checks:

```bash
po-shell checks suggest
po-shell checks suggest --write
```

Detecta Node, Go, Rust, Python, Maven, Gradle, Makefile y justfile.
No ejecuta nada solo.

Limpieza de estados huérfanos:

```bash
po-shell projects prune --dry-run
po-shell projects prune --yes
```

Mueve los estados sin `project.json` a `~/.po-shell/trash/<fecha>/`, no los borra.

## Tests

```bash
npm test
npm run check
```

## Licencia

MIT.
