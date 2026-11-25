# Subagentes: gentle-shell vs po-shell

Comparación del sistema de subagentes de gentle-shell (`~/dev/gentle-shell`) contra
`po_shell_delegate`, y el backlog de portes que quedó pendiente.

No hay código de nada de esto en po-shell todavía. Es material para decidir.

## Escala

| | gentle-shell | po-shell |
|---|---|---|
| Código | ~11.000 L: 23 archivos `lib/agents-*` (~7.500), `extensions/gentle-agents.ts` (3.727), `extensions/child-*.ts` | 294 L: `src/delegate.js` (259), `prompts/po-shell-subagent.md` (21), `extensions/po-shell-subagent.ts` (14) |
| Tools | 9 del padre + 1 del hijo + 4 de pares | 1 (`po_shell_delegate`) |

No es el mismo producto con más features: gentle-shell es una plataforma multi-agente de
escritorio; po-shell es una unidad de trabajo acotada con evidencia.

## El modelo de gentle-shell

### 1. Los agentes son datos

Cada agente es un `.md` con frontmatter, descubierto en raíces de proyecto y usuario:

```yaml
name: gentle-ai-explore
description: Read-only local and web exploration on its configured economical model.
tools: [read, grep, find, codegraph, web_search, ...]
```

`lib/agents-config.ts` los completa con `subagents.json`: `defaultModel`, `defaultThinking`,
`modelProfiles`, `stall_timeout_ms` (4 min), `tool_stall_timeout_ms` (30 min),
`maxConcurrency: 5`, `historyMaxTasks`, `report_max_bytes: 16384`.
Hay 10 agentes incluidos en `assets/agents/`.

En po-shell los roles (`explorer`, `worker`, `reviewer`) eligen modelo y capacidades; el
prompt y el tool set son los mismos para todos.

### 2. Lanzamiento

```text
pi --mode rpc --session-dir <dir> [--session <resume>] [--model] [--thinking]
   [--tools <lista>] --append-system-prompt <archivo temporal>
```

- canal IPC (`child_process` `ipc`) para hablar con el padre en vivo;
- fd 3 como canal de permisos (`ParentStandingReviewPermissionBroker`);
- `TMPDIR` propio, `GENTLE_PI_AGENTS_CHILD=1`, y borra `GENTLE_SHELL_INTERACTIVE_HOST`
  para que un hijo nunca se crea host interactivo;
- `--session` permite reanudar el mismo hijo.

po-shell: `--mode json --no-session --no-extensions`, misión por argv. Un disparo sin canal.

### 3. Superficie

Padre: `subagent_run` (bloqueante), `subagent_continue` (mismo hijo, nueva orden),
`status`, `result`, `list_tasks`, `list_agents`, `cancel`, `reply`, `send_message`
(injecta antes de la próxima llamada al modelo), `launch` (background).
Hijo: `subagent_parent_message` con `kind: notification | query`; un `query` bloquea al hijo
con deadline y alarga su presupuesto de silencio mientras espera.
Pares: `orchestrator_session_id`, `_list`, `_consult`, `_send_message`.

### 4. Límites

| Límite | gentle-shell | po-shell |
|---|---|---|
| Tiempo | presupuesto de silencio **renovable**: 4 min idle, 30 min si hay tool anunciada | timeout **absoluto** 10–3600 s |
| Tokens | usage por tarea + cola `maxConcurrency` | `max_tokens` + `max_turns` |
| Reporte | cap de 16 KiB cabeza+cola, nunca corta JSON, texto completo por `subagent_result` | sin cap |
| Escritura | `bounded-writer-admission.ts`: la tarea declara `## Allowed edit surfaces` y se rechaza en `tool_call` todo write fuera | ninguna |
| Permisos | el hijo no hereda yolo/auto; destructivos bloqueados secos | guard de tools, `.md`/estado, y ahora formas destructivas |
| Background | `bash_background` exige policy `on` al despachar; ventana de drain al asentar | no existe |
| Cierre | drain 5 s + cleanup 5 s, kill por grupo de procesos | SIGTERM → SIGKILL a los 2 s |

### 5. Observabilidad y verificación

- Threads por tarea (ring-buffer `text/thinking/tool/note`), cards en TUI y payload RPC
  `gentle-agents.activity/v1` con coalescing de 150 ms y escalera de truncado hasta 256 KiB.
- `agent-status/<sha>.json` con heartbeat de 10 s, 0700/0600, rechazo de symlinks.
- Verificación delegada: el padre hace un solo spot-check de un comando reportado; el
  verificador independiente se admite con gramática estricta (`Risk: item N (reason)`).

## Por qué existen las divisiones

Fuentes: código de gentle-shell más los videos de Gentleman Programming
([Full Delegation Mode](https://www.youtube.com/watch?v=CfzEkEhicbg), 2026-11-23;
[ORCHESTRATOR-MINION](https://www.youtube.com/watch?v=vRydZQZ08OQ);
[RDD](https://www.youtube.com/watch?v=t_HEm1om2Ek)).

Las divisiones no son roles decorativos: cada corte resuelve un problema distinto.

| Corte | Qué separa | Problema que resuelve |
|---|---|---|
| **Por rol** | explorar (solo lectura) / escribir (mutación acotada) / verificar (evidencia independiente) / juzgar (revisión ciega) | quien escribe no puede aprobar su propio trabajo; quien explora no puede corromper nada |
| **Por modo** | delegación orgánica (inline mientras alcance) / *full delegation* (el orquestador nunca escribe) | costo y contexto: un modelo frontier decidiendo y modelos baratos ejecutando |
| **Por proceso** | cada hijo corre en sesión nueva, con contexto fresco, produce un artefacto y **no orquesta a otros** | el contexto del padre no se llena de tool output; Compactación no borra decisiones |
| **Por límite** | runtime (hooks, admission, caps) vs prompt | el prompt no puede garantizar nada y además gasta contexto |

Los objetivos, en palabras del propio autor:

1. **Contexto**: el padre razona, mantiene el hilo con el humano y controla artefactos; el hijo ejecuta y
   devuelve un reporte.
2. **Costo**: frontier para decidir, barato para escribir. "Si el plan es bueno, los subagentes no
   tienen que razonar: van a ejecutarlo".
3. **Independencia**: la verificación es de otro actor, con evidencia observable, porque el modelo
   reporta éxito aunque no lo tenga (de ahí RDD).
4. **Paralelismo**: varios hijos a la vez mientras el padre sigue conversando.
5. **Determinismo**: lo que no puede ser una excepción vive en código, no en prosa.

Lo que **no** es: no es SDD ni una ceremonia obligatoria ("no tiene pegas": se puede implementar y
verificar cuando hace falta, no siempre), no es un panel de modelos para todo, y "más delegación no
significa mejor resultado": en tareas chicas el costo y el tiempo son casi iguales.

Detalle operativo del modo *full delegation*: vive en el **perfil**, se aplica en runtime y cambia
solo *quién muta*. El padre conserva autorizar, explorar, decidir, preguntar, escribir el feature doc
y commitear. Rechazaron explícitamente "todo delegado sin excepción". Y va en runtime, no en el
prompt, porque el prefijo del sistema se cachea: un switch por prosa rompería el cache hit (98 % en
el stream) y sumaría contexto en cada turno.

## Cómo encaja en po-shell

po-shell ya tiene delegación **orgánica** (el protocolo nombra 4 razones para delegar) y ya tiene
los cortes de riesgo y evidencia. Le falta el eje explícito y su enforcement:

| gentle-shell | po-shell hoy | Falta |
|---|---|---|
| Rol `explore` (read-only) | `role: explorer` = solo cambia el modelo | el tool set por rol ya lo controla el guard; falta que el rol *write* tenga superficies |
| Rol `write` (bounded) | `role: worker` | `surfaces` + rechazo en `tool_call` del hijo |
| Rol `verify` | `po_shell_check` corre en el padre | marcar quién corrió el check y con qué evidencia |
| Modo `full delegation` | no existe | `delegation: inline \| delegate-writes` como dato de la tarea y bloqueo del `edit`/`write` del padre en el hook |
| Cap del reporte | no existe | A del backlog |
| Stall budget | timeout absoluto | B del backlog |

Los tres portes que completan el eje, en orden de costo:

| # | Porte | Diseño mínimo | Costo |
|---|---|---|---|
| E | **Modo de delegación como dato** | `po_shell_task` acepta `delegation: inline \| delegate-writes`; el hook `tool_call` ya existente bloquea `edit`/`write` del padre en `delegate-writes` (misma mecánica que el gate de plan aprobado) | ~40 L + tests |
| F | **Roles con modelo y superficie** | `po_shell_delegate` gana `role: explore \| write \| verify` y `surfaces: []` para `write`; `models[role]` ya existe en config | ~70 L + tests |
| G | **Evidencia de quién verificó** | `po_shell_check` registra `actor: self \| delegate` y `review freeze` marca si el diff lo escribió un hijo | ~40 L + tests |

E es el de mejor relación costo/beneficio: reusa el hook que ya bloquea escrituras sin plan aprobado,
no toca prompts, y convierte "el padre no implementa" en una regla del kernel. Depende de A y B para
que delegar sea barato en contexto y seguro en tiempo.

## Implementado (v0.12)

| Pieza | Dónde | Qué hace |
|---|---|---|
| Contratos por rol | `prompts/subagents/{explore,worker,reviewer}.md` | ~30 líneas por rol: qué puede tocar, qué nunca, qué devuelve. El hijo recibe el protocolo común + su contrato (`--append-system-prompt` repetido) |
| Superficies de escritura | `surfaces` en `po_shell_delegate`, `src/subagent-policy.js` | un `worker` sin superficies no arranca; el guard del hijo rechaza `write`/`edit` fuera y también redirecciones de shell (`>`, `tee`, `sed -i`, `cp`/`mv`) |
| Cap del reporte | `capReport` en `src/delegate.js`, `reportMaxBytes` | 16 KiB por defecto, cabeza + cola + puntero al artefacto; un reporte JSON nunca se corta |
| Perfil full delegation | `delegation` en la tarea, gate en `checkPolicy` | `delegate-writes`: el padre decide, explora, escribe `docs/features/` y commitea; toda mutación de código va a un worker. Aplicado por el kernel, no por el prompt |
| Regla de exploración | `prompts/po-shell-protocol.md`, `skills/po-shell-workflow/SKILL.md` | área desconocida o tercera llamada de descubrimiento → `explorer` obligatorio |

Las letras A, E, F del backlog de abajo quedaron cubiertas. Lo que sigue pendiente es B (presupuesto
de silencio renovable: hoy el timeout sigue siendo absoluto), D (`po_shell_agents` list/result) y G
(evidencia de quién verificó).

## Backlog de portes (lo que falta)

| # | Porte | Por qué | Costo |
|---|---|---|---|
| B | **Presupuesto de silencio renovable** | el timeout absoluto castiga al hijo que trabaja y no detecta al que se colgó | ~40 L + tests |
| D | **`po_shell_agents` list/result** | leer estado y resultado sin re-ejecutar | ~60 L |
| G | **Evidencia de quién verificó** | hoy `po_shell_check` no distingue si corrió el padre o se confió en el hijo | ~40 L |

## Qué no se porta

- `--mode rpc` + IPC + `send_message`/`reply`/`continue`: ~1.500 L y un modelo mental de
  sesiones vivas; el valor de po-shell está en misiones cortas y verificables.
- Vistas TUI, publisher RPC y `agent-status`: son superficie del producto de escritorio.
- `orchestrator_*`: descubrir otras sesiones no aplica a un arnés de una sesión.
- `maxConcurrency`: en po-shell la concurrencia la decide el modelo con llamadas separadas.

Si se retoma, el orden sugerido es A + B (sin UI, testeables), después C, después D.
