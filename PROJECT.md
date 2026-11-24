---
status: confirmed
updated: 2026-11-21
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
- **Instalación:** hoy `npm link` desde el checkout (el paquete no está publicado); después `npm i -g po-shell`. El instalador propio está pendiente. Pi se detecta en el `PATH` o se configura con `PO_SHELL_PI_BIN`.
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
  status.md                           estado, pendientes, pausados, descartado
  agents-md-y-skill-md-investigacion.md  criterios para instrucciones de agentes
```

`AGENTS.md` es la fuente de verdad del comportamiento del agente en el repo. `PROJECT.md` es la fuente de verdad del proyecto para humanos. No dupliques secciones entre los dos.

## 7. Estado y próximos pasos

El detalle está en `docs/status.md`.

- **Hecho:** kernel, CLI, launcher, policy, checks, review congelado, memoria, directivas, subagentes aislados, modelos fijos por rol, `doctor`, `checks suggest`, `projects prune`, ledger de costo, `backup`, `restore`, `integrity`, runbook de recuperación y scratch temporal por sesión/subagente.
- **Pendiente:** instalador propio, MCP, sandbox, evals, scope `personal`, deduplicación, `checks set`.
- **Pausado:** perfiles de subagentes, `AGENTS.md` por subagente, medición ampliada.
- **Descartado:** router automático por fase, `.po-shell` dentro del repo, modelo frontera por defecto.

