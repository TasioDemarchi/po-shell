---
type: feature
status: active
---

# Feature: the project documents belong to the orchestrator

Risk: high

## Outcome

Que `PROJECT.md`, `AGENTS.md` y `README.md` se puedan actualizar en **cualquier** perfil, porque son
del orquestador: es el único con las palabras del usuario y el que responde por el estado del
proyecto. Un hijo sigue sin poder escribir ningún `.md`, y eso no cambia.

## Pain

`PARENT_WRITE_SURFACES` solo incluía `docs/features/`. Con una task `medium` o `high` activa
(`delegate-writes`), el padre no podía tocar `PROJECT.md`, y `src/subagent-policy.js` rechaza todo
`.md` en un hijo. Nadie podía actualizar los documentos, aunque la propia *Definition of done* de
`AGENTS.md` los exige: `PROJECT.md` quedó afirmando que el próximo paso era `web_fetch` cuando ya
estaba commiteada. La única salida era una task `low` inline, o sea que la coherencia de los
documentos dependía del perfil del momento.

## Design

Una constante, tres entradas más:

```js
const PARENT_WRITE_SURFACES = ["docs/features/", "PROJECT.md", "AGENTS.md", "README.md"];
```

- Vale para `write` y `edit` del padre y para los targets que `bash` escribe, que ya usan la misma
  función.
- **El código sigue bloqueado**: cualquier otro path dentro del repo se niega con el mismo mensaje, y
  el perfil `inline` sigue permitiendo todo.
- **El guard de hijos no cambia**: `src/subagent-policy.js` sigue rechazando `.md` para cualquier
  rol. La asimetría es deliberada: el padre documenta, el hijo no inventa contexto.
- La decisión es de permisos, no de contenido: no se valida qué dice el documento, porque el humano
  lo revisa en el diff y los checks de documentos ya cubren la consistencia (`npm run docs:check`).

## Units

- [x] **U1 — Las superficies.** `PARENT_WRITE_SURFACES` con los tres documentos; tests de que el
      padre escribe los tres bajo `delegate-writes`, sigue bloqueado para `src/` y para
      `docs/architecture.md`, y que el guard de un hijo sigue rechazando `.md`. (D1)

## Out of scope

- Permitir `.md` a un hijo, ni siquiera dentro de sus superficies.
- Validar el contenido de `AGENTS.md` o `README.md` al escribirlos.
- Cambiar cuándo un perfil es `delegate-writes`: eso sigue saliendo del riesgo.

## Decisions

- D1 — El orquestador es el único que actualiza PROJECT.md, AGENTS.md y README.md, en cualquier perfil: las superficies del padre los incluyen junto con docs/features/, el código sigue delegado y un hijo sigue sin poder escribir .md.
