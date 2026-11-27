---
type: feature
status: active
---

# Feature: what a searcher needs to know — the explorer's method and its map

Risk: medium

## Outcome

Que un explorer llegue a la evidencia en menos turnos: una estructura de búsqueda que no dependa de su
suerte, y un mapa del código que responda «quién llama a esto» sin tres `grep` fallidos.

## What the explorer has today

| Pieza | Dónde | Qué le da |
|---|---|---|
| Contrato del rol | `prompts/subagents/explore.md` (30 líneas) | Qué puede, qué no, y el formato del entregable |
| Misión | `src/delegate.js:buildMission` | Tarea, `context_files`, `build_test`, `surfaces`, DONE WHEN, presupuesto |
| Memoria read-only | `src/subagent-memory.js` | `memory_search` filtrado al proyecto |
| Herramientas | `read`, `grep`, `find`, `ls`, `memory_search`, `web_fetch` | Sin bash, sin escritura |
| **`AGENTS.md`** | **no llega** | `--no-context-files` (`src/delegate.js:107`) apaga el descubrimiento de AGENTS.md y CLAUDE.md de Pi, y el hijo no lo lee salvo que el padre lo nombre en `context_files` |

Ese último renglón es el hallazgo: el Map de `AGENTS.md` —la tabla que dice qué hace cada archivo— existe
y el explorer no lo ve a menos que el padre se acuerde. Pagar un turno por leer algo que el proyecto ya
tiene escrito es el patrón de siempre: el hijo administra lo que no ve.

## El costo medido

De los runs de `docs/features/worker-missions.md`: seis turnos antes de la primera edición cuando la
misión describía el arreglo en prosa, uno cuando traía el parche. Un explorer real leyó en el turno 1
el feature doc con `cat`, después grep, después dos `read` de ventanas: cuatro turnos para orientarse, y
el que falló gastó los dieciséis abriendo archivos enteros y releyendo rangos.

### La prueba de este análisis

Una misión de tres preguntas que un mapa contesta leyendo un archivo (`run-mwz80mym-r8h8`):
quién importa `src/kernel.js`, qué exporta `src/minimal-ui.js`, dónde aparece `FRAME_BODY_MAX`.
Resultado: **21 llamadas en 5 turnos, sin reporte**, 0.21 cr.

Lo que hizo, en orden: `grep "kernel\.js"` (el nombre del archivo, no la forma del import), `grep
"FRAME_BODY_MAX"`, `grep "minimal-ui\.js"`, `ls src`, `grep "^export "` dentro del archivo, `grep
"kernel\.js"` con 14 líneas de contexto **acotado a `src/cli.js`**, y después cinco `read` de cabeceras
de tests y tres relecturas de `src/cli.js` (offsets 18, 14 y el archivo entero) para ver si el match era
o no un import. Terminó sin contestar.

Tres diagnósticos de una sola corrida:

1. **`grep` por nombre de archivo no contesta quién lo importa.** La forma correcta es
   `from "\.\./src/kernel\.js"`, y nadie se la dijo.
2. **Sin mapa, cada pregunta es una expedición.** Un archivo con las dependencias inversas habría
   cerrado la primera en un `read`.
3. **No hay regla de corte.** Después de dos intentos fallidos siguió gastando: 21 llamadas para tres
   datos. La regla que falta es «a la segunda, reportá lo que tenés y decí qué falta».

Y su turno de cierre no sirvió: el run empezó un sexto turno y murió antes de escribir la primera
palabra. El turno de gracia sólo salva al hijo que llega en texto, no al que está adentro de una tool.

## The three structures

### 1 · El método en el contrato del rol

Un orden explícito de búsqueda, en el único texto que el hijo lee sin gastar un turno:

1. **Orientarse.** Si la misión nombra una entrada, empezar ahí. Si no, leer el mapa.
2. **Ubicar** con un `grep` por símbolo, no por nombre de archivo, y para imports por la forma
   (`from "…/archivo.js"`), nunca por el nombre suelto.
3. **Leer ventanas** de 60 líneas, archivo entero solo si tiene menos de 150.
4. **Confirmar relaciones** con quien importa, no con quien parece.
5. **Reportar** cada afirmación con `path:line` y la incógnita con el archivo que la cerraría.
6. **Cortar a la segunda.** Si dos intentos no cerraron una pregunta, reportar lo que hay y decir qué
   falta; seguir buscando con el mismo método es gastar el presupuesto en el mismo error.

Y las trampas medidas, escritas como prohibiciones: no releer un rango ya leído, no abrir lo que la
misión declaró fuera de alcance, no narrar el proceso, no leer entero lo que se puede ubicar.

**A favor:** cero infraestructura, se aplica a todo hijo desde el primer turno.
**En contra:** es prosa, y en este repo una regla en prosa es una sugerencia.

### 2 · Un mapa del código generado, no escrito

`scripts/code-map.mjs`, sin dependencias, recorre `src/`, `extensions/` y `scripts/` y emite
`code-map.md` bajo `docs/`: por archivo, qué exporta, qué importa y **quién lo importa** (dependencias
inversas), más los puntos de entrada. Se verifica con un test: si el mapa no coincide con el código,
`npm test` falla, así que no puede envejecer.

**Por qué dependencias inversas:** es la pregunta que `grep` contesta mal. «¿Quién usa
`knowledgeSince`?» devuelve tres coincidencias y una es la definición; el mapa lo dice en una línea.
Medido: el run de las tres preguntas gastó 21 llamadas y no cerró ninguna.

**A favor:** un turno en vez de veintiuna llamadas, determinístico, y no se pudre.
**En contra:** un archivo más que mantener (aunque lo mantiene el script) y una responsabilidad que el
Map de `AGENTS.md` ya insinúa: hay que decidir cuál manda para qué.

### 3 · Comentarios que el worker deja

Marcas en el código del tipo `// MAP: entrada de ...`.

**En contra, y por qué no:** el comentario lo escribe el mismo modelo que puede equivocarse, nadie lo
verifica, y envejece sin que nada falle. Es la peor de las tres porque agrega prosa ejecutable en el
único lugar donde la prosa compite con el código. Lo durable de una lección ya va a memoria
(buscable) y lo que explica una decisión ya va al feature doc.

## Y codegraph

Lo que dan las herramientas de verdad (`codegraph`, SCIP, tree-sitter): tipos, resoluciones, llamadas
cruzadas, grafos de impacto. Lo que cuesta: una dependencia de runtime, un binario o un parser nativo,
y una instalación por plataforma. Rompe la invariante 9 del proyecto y el presupuesto $0.

El patrón ya existe en este repo para esto: `web_search` quedó como etapa 2 **opt-in por variable de
entorno**, y sin la variable el arnés no pierde nada. Si el mapa generado no alcanza, el camino es el
mismo: `PO_SHELL_CODEGRAPH` con un adaptador, y el mapa propio como piso. No al revés.

### El mapa, medido sobre este repo

Un prototipo de 60 líneas sobre `src/`, `extensions/` y `scripts/`:

- **40 archivos, 91 aristas de import, 7 hojas.** Todo se relaciona con algo.
- **`src/util.js` lo importan 12 archivos; `kernel.js` 5; `minimal-ui.js` 3.**
- **`kernel.js` exporta 51 nombres** y `minimal-ui.js` 40: ahí está el costo real de `grep`, porque
  «quién usa `knowledgeSince`» devuelve la definición y los usos mezclados.
- El prototipo completo, con dependencias inversas y los nombres que cada uno importa, son **242 líneas
  y 12 KiB**: un `read`, tres mil tokens, contra 21 llamadas y cinco turnos sin respuesta.

242 líneas es más de las 150 que el contrato del rol permite leer enteras. Dos salidas: compactar la
lista de importadores en una línea por archivo (queda en ~180), o decir en el contrato que el mapa se
lee entero. La primera es mejor: menos tokens y el mismo dato.

### Las tres formas de entregarlo

| Forma | Turnos por pregunta | Se mantiene | Trabajo |
|---|---|---|---|
| **Archivo generado** (`code-map.md`) | 1 `read` contesta todas | test de frescura | script + test |
| **Tool `code_map`** | 1 llamada por pregunta | siempre fresco | script + tool + matriz de roles + guard + contrato |
| **Slice inyectado en la misión** | 0 | depende del padre | nada, pero el padre tiene que saber qué pedir |

El archivo gana: contesta N preguntas con un turno, entra en un diff que se puede leer, y su riesgo de
envejecer ya está resuelto por el test. La tool gana en frescura —que el test también resuelve— y pierde
en que cada pregunta cuesta una llamada y en que agrega un verbo nuevo a un hijo que solo lee.

## Cómo lo ataca gentle-shell

Comparación con el harness hermano (`/home/tachii/dev/gentle-shell`, mismo Pi, mismas piezas), leída
en su código:

| Pregunta | po-shell hoy | gentle-shell |
|---|---|---|
| **Contexto del hijo** | `--no-context-files`: el hijo no ve ningún `AGENTS.md` | El hijo carga los mismos context files que el orquestador y después un filtro quita los bloques que solo obligan al padre (`lib/child-context-files.ts:1-20`): son **~37k tokens de prefijo por hijo**, y le daban al worker reglas de orquestación que no le tocan |
| **Buscar código** | `grep`/`find` y suerte | Tool `codegraph` con índice propio (`.codegraph/`), y el contrato manda usarlo **antes** de barrer el filesystem; `grep` es el fallback, no el método (`assets/agents/gentle-ai-explore.md`) |
| **Presupuesto de búsqueda** | Contador de llamadas, visible a las 3 | `lib/exploration-budget.ts`: mide **lookups y bytes leídos** (3 lookups + 40 KB), e inyecta un aviso en runtime: «ongoing discovery needs one configured explorer» |
| **Memoria del hijo** | Nadie escribe: solo el explorer puede leer | El **worker puede** `mem_save`; el explorer no lo tiene en su lista de tools. Lo durable lo escribe quien cambió algo |

Tres lecciones que se pueden copiar sin traer la dependencia:

1. **El contador tiene que medir bytes, no solo llamadas.** 21 `grep` de tres líneas no es lo mismo que
   leer 40 KB. Nuestro nudge cuenta llamadas; el suyo pesa evidencia.
2. **El fallback no es el método.** Ellos tienen grep y aun así el contrato dice «codegraph primero, y
   solo si falla, grep». Nuestro contrato puede decir lo mismo sobre el mapa: leerlo primero, grep
   después.
3. **Al hijo se le quita lo que no le toca, no todo.** Nosotros apagamos AGENTS.md entero para no
   pagar; ellos lo cargan y filtran. Filtrar es más caro de mantener pero no le esconde al hijo las
   convenciones que sí debe respetar.

Y una diferencia de criterio que vale discutir: allá el worker escribe memoria; acá el protocolo dice
que un hijo nunca escribe `.md` ni memoria. La razón de ellos es razonable —quien cambió el código es
el que tiene el hallazgo verificado— pero nosotros tenemos el nudge de `memoria: 0 desde implementing`
que obliga al padre a destilar, y eso hoy funciona.

## Recommendation

Las tres primeras no compiten, se ordenan por costo:

1. **Inyectar `AGENTS.md`** al explorer (y al worker) como contexto que llega sin turno: es la pieza que
   ya está escrita y hoy se paga.
2. **El método en el contrato del rol**, con las prohibiciones medidas.
3. **El mapa generado**, con dependencias inversas y test que lo mantiene honesto.

Codegraph queda como etapa 2 con variable de entorno, sólo si el mapa demuestra quedarse corto.

## Units

- [ ] **U1 — El método.** Contrato del explorer con el orden de búsqueda y las prohibiciones.
- [ ] **U2 — El contexto que llega solo.** `AGENTS.md` inyectado en la misión, decidido y medido.
- [ ] **U3 — El mapa.** `scripts/code-map.mjs`, `code-map.md` bajo `docs/` y el test de frescura.
- [ ] **U4 — La medición.** La misma misión de tres preguntas, con mapa y sin mapa (la línea base ya
      está: 21 llamadas, 5 turnos, sin reporte), para comparar turnos y créditos.

## Out of scope

- Implementar codegraph o cualquier dependencia nueva.
- Cambiar las herramientas del explorer (sigue sin bash).
- Comentarios de mapa en el código.
