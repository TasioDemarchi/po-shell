# Arquitectura y memoria

## Arquitectura

```text
po-shell (launcher)
   │ inicia
Pi (TUI + loop del modelo)
   │ tools + hooks
Adaptador (extensions/po-shell.ts)
   │
Kernel (src/kernel.js)
   │
Almacenamiento (~/.po-shell/projects/<id>/ + ~/.po-shell/context.db + ~/.po-shell/tmp/)
```

| Capa | Responsabilidad |
|---|---|
| **Launcher** | Iniciar Pi con po-shell cargado, resolver rutas y variables |
| **Modelo** | Decidir qué hacer |
| **Adaptador** | Exponer tools, interceptar tool calls, inyectar contexto |
| **Kernel** | Estado, fases, políticas, evidencia, review |
| **Almacenamiento** | Verdad durable e inspeccionable |

### Forma del producto

```bash
po-shell                 # inicia Pi con el arnés cargado
po-shell task new "..."  # comandos del kernel
po-shell status
po-shell doctor          # chequea Node, Pi, git y extensión
```

- `po-shell` sin argumentos = agente.
- `po-shell <subcomando>` = CLI.
- El launcher carga la extensión y las skills, e inyecta el protocolo del orquestador.
- No crea un home aislado por defecto: usa el home de Pi para que auth y modelos funcionen.
- `PO_SHELL_PI_AGENT_DIR` permite usar un agent dir propio; un `--home` completo no está implementado.

### Componentes

| Componente | Estado |
|---|---|
| `kernel.js` | Tareas, fases, memoria, checks, reviews |
| `project.js` | Identidad estable del proyecto, adopción del estado existente por root y resolución del estado central |
| `indexer.js` | Índice SQLite FTS5 de docs por sección y memorias |
| `context.js` | `context_search` / `context_get` sobre el índice |
| `backup.js` | Backup, restore e integrity del estado central |
| `scratch.js` | Scratch de sesión y subagentes, ledger y sweep |
| `scratch-guard.js` | Bloqueo de tests que meten `TMPDIR` en el repo |
| `costs.js` | Tarifas Nan, cálculo de créditos y ledger en SQLite |
| `delegate.js` | Subagentes en procesos Pi aislados |
| `semantic.js` | Embeddings y rerank con fallback FTS |
| `policy.js` | Deny paths/commands, gate determinista |
| `cli.js` | Comandos para humanos y scripts |
| `install.js` | Reporte de instalación, detección npm/pnpm/link y planes de update/uninstall |
| `scripts/install.mjs` | Verificador de instalación (también corre como `postinstall`) |
| `extensions/po-shell.ts` | Tools + hooks para Pi |
| `skills/po-shell-workflow` | Procedimiento para el agente |
| `src/shell.js` | Launcher: resuelve Pi, carga extensión y skill, inicia la TUI |

## Memoria y contexto

### Principio

> **Los docs son la verdad que se lee. El índice es la verdad que se busca. La memoria es la verdad que se recuerda.**

### Dos corpus, una búsqueda

| Corpus | Fuente de verdad | Dónde vive | Índice |
|---|---|---|---|
| **Specs** | `.md` en el repo | `docs/` o raíz | `doc_chunks` |
| **Memorias** | SQLite | `~/.po-shell/context.db` | `memories` + FTS |

La búsqueda es híbrida:

```text
FTS exacto + embeddings (qwen3-embedding) + rerank
```

Si Nan no está disponible, cae a FTS exacto con variantes singular/plural y fallback OR.

Dentro de Pi, `/semantic on|off` cambia el modo para la sesión actual.

Una sola herramienta de contexto:

```text
context_search({ query, project, kinds: ["spec", "memory"], limit: 5 })
context_get({ kind: "spec", id: "spec:docs/x.md#2" })
context_get({ kind: "memory", id: "mem:arch-upload" })
```

### Qué guarda cada cosa

| Qué | Dónde |
|---|---|
| Objetivo, alcance, requisitos, arquitectura | Docs `.md` |
| Por qué se decidió algo | Memoria (`decision`) |
| Error no obvio, causa y prevención | Memoria (`bugfix`) |
| Regla de comportamiento del agente | Memoria (`behavior`) |
| Hecho estable del entorno | Memoria (`fact`) |
| Preferencia de estilo o proceso | Memoria (`preference`) |
| Estado operativo de una tarea | Snapshot de memoria (`state`) |
| Resumen de una feature | Snapshot de memoria (`feature`) |
| Checkpoint de compactación | Snapshot de memoria (`session`) |

### Formato de memoria

Base:

```text
WHAT: ...
WHY: ...
WHERE: ...
LEARNED: ...
```

Para `bugfix`, opcional:

```text
SYMPTOM: ...
CAUSE: ...
FIX: ...
PREVENTION: ...
```

### Reglas

- La memoria no edita la spec. Si una lección cambia un requisito, lo decide un humano.
- Si una decisión cambia el estado actual, se actualiza el doc **y** se guarda o actualiza el snapshot de memoria, con contenidos distintos.
- Si no cambia el estado actual, solo memoria.
- Se indexa por sección, no por archivo entero.
- En `docs/features/*.md` solo se indexan secciones estables: resultado, specs, límites, no-objetivos, decisiones y supuestos.
- `Tasks`, `Estado` y `Log` no se indexan: son estado mutable y se leen del archivo o de `po-shell status`.
- La búsqueda devuelve preview; el cuerpo se trae solo para 1-2 resultados.
- Sin ADRs: las decisiones van en la memoria.
- `INDEX.md` aparece recién con más de ~8 docs.
- Cada memoria se escribe en un solo idioma. En proyectos en español, español.
- El índice semántico permite buscar entre idiomas; el FTS sigue disponible como fallback.
- No mezclar idiomas dentro de una memoria: degrada tanto la búsqueda exacta como la semántica.
- Cada memoria puede declarar `aliases` bilingües cortos; el FTS los indexa y la búsqueda exacta los encuentra.
- Tipos operativos: `state`, `feature` y `session` son snapshots; se actualizan por `topic` y no son la fuente de verdad.
- Al retomar: memoria primero; si no hay hit o falta detalle, leer el feature doc.
- Los embeddings se calculan lazy y se guardan en SQLite; `po-shell index` no llama a la API.
- El adapter guarda un snapshot `state` al crear/actualizar una tarea y al correr checks.
- Antes de compactar guarda `session/current`; después de compactar lo inyecta en el siguiente turno.
- SQLite es la fuente canónica de memorias; `memory/*.md` es un mirror de auditoría.
- Las memorias son globales: se prioriza el proyecto actual y, si no hay resultados, se busca en el resto.
- Un resultado de memoria con `requiresConfirmation` es global: el agente debe frenar y pedir validación humana antes de usarlo.
- Para consultar otro proyecto desde cualquier cwd, usar `project` con nombre, id o root registrado; no indexar el cwd a ciegas.
- Si la DB está vacía, el indexador importa memorias Markdown legacy una vez.
