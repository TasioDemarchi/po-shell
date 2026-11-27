---
type: feature
status: active
---

# Feature: the orchestrator writes prose, the child writes code

Risk: high

## Outcome

Que el orquestador pueda escribir los documentos que le son propios —`docs/` entero y `prompts/`— sin
abrir una sola ruta de código, y que siga sin poder tocar `src/`, `extensions/`, `scripts/` ni `test/`
bajo el perfil `delegate-writes`.

## Pain

Dos piezas de este mismo trabajo no las puede escribir nadie:

- **`prompts/subagents/explore.md`**: el contrato del explorer. Es texto para un agente, no código. El
  padre no puede escribirlo (solo tiene `docs/features/`, `PROJECT.md`, `AGENTS.md`, `README.md`) y el
  hijo tampoco (el guard rechaza cualquier `.md` para todo rol). La regla del rol se quedó congelada.
- **`docs/code-map.md`**: el mapa generado. Es la salida de `scripts/code-map.mjs` y no hay forma de
  commitearla: `npm run code:map` redirige a una ruta que el gate del padre bloquea, y el hijo no escribe
  markdown.

El resultado es una asimetría sin defensa: el padre puede editar `docs/features/` pero no
`docs/architecture.md`, y no puede tocar el contrato de un rol que sí puede ejecutar.

## Design

- **Superficies del padre:** `docs/`, `prompts/`, `PROJECT.md`, `AGENTS.md`, `README.md`. `docs/features/`
  queda cubierto por `docs/`.
- **Lo que no cambia:** el hijo sigue sin poder escribir ningún `.md` ni el estado central, y el padre
  sigue sin poder escribir `src/`, `extensions/`, `scripts/`, `test/`, `bin/`, `templates/`,
  `skills/`, `bench/`. La frontera código/texto se mantiene; lo que se corrige es la frontera entre
  documentos.
- **El mensaje del gate** dice la nueva lista, para que el modelo no tenga que adivinarla.
- **`AGENTS.md`**: la regla «los documentos del proyecto son del orquestador» incorpora `prompts/` y el
  resto de `docs/`.

## Por qué es `high`

Es una guarda de permisos: cambia qué rutas quedan escribibles para el perfil `delegate-writes`. Aunque
solo habilita texto, el invariante del repo dice que lo que no puede ser una excepción vive en código, y
toda excepción nueva a una guarda se aprueba explícitamente.

## Units

- [x] **U1 — Las superficies.** `PARENT_WRITE_SURFACES` con `docs/` y `prompts/`, mensajes del gate al
      día y tests: el padre escribe `docs/architecture.md` y `prompts/subagents/explore.md`, y sigue
      bloqueado en `src/` y `extensions/`. (D1)
- [x] **U2 — El documento.** `AGENTS.md` con la regla nueva y con el método de búsqueda; el mapa como
      archivo generado. (D1)
- [x] **U3 — Lo que destraba.** El mapa generado (`po-shell map`, 42 archivos y 93 aristas) y el método
      de búsqueda que ahora viaja dentro de cada misión. (D1)

## Out of scope

- Abrir cualquier ruta de código al padre.
- Permitir que un hijo escriba markdown.
- Cambiar el perfil `inline`.
