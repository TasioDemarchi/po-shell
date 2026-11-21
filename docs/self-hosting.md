# Self-hosting

Plain puede usarse para mejorar Plain. Eso es dogfooding: el arnés trabaja sobre su propio código.

## Regla base

```text
main = known good
rama test = cambios auto-modificados
baseline verde + backup = salida de emergencia
```

No empieces a modificar el launcher, la policy o la extensión sin una versión conocida a la que volver.

## Preparación

Desde el repo:

```bash
git status
npm test
npm run check
plain integrity
plain backup
git tag selfhost-baseline
```

El working tree debe estar limpio salvo cambios que entiendas. No arranques con deuda mezclada.

## Rama o worktree

Opción simple:

```bash
git switch -c test/selfhost
```

Opción aislada:

```bash
git worktree add ../plain-selfhost -b test/selfhost
cd ../plain-selfhost
```

Plain identifica un proyecto por su remote o root. Un worktree puede compartir el estado central con el repo principal: no tengas dos sesiones escribiendo tareas o memoria al mismo tiempo.

## Qué tocar primero

Orden recomendado:

1. Documentación.
2. Tests y fixtures.
3. Un bugfix pequeño del kernel con test.
4. Mejoras de CLI.
5. Cambios de extension/hooks.
6. Launcher, policy o recovery.

Launcher, policy y recovery son la vía de arranque: si se rompen, podés quedarte sin poder abrir una sesión normal.

## Fallback de emergencia

Si `plain` deja de abrir:

```bash
node bin/plain.js doctor
node bin/plain.js integrity
node bin/plain.js help
```

También podés volver al tag:

```bash
git switch main
git switch -c fix/launcher
```

Y restaurar estado:

```bash
plain restore <backup-dir> --yes
plain integrity
```

## Reglas para la sesión de self-hosting

- Un cambio pequeño por tarea.
- Cada cambio de kernel o policy necesita test.
- Antes de tocar estado, backup + integrity.
- No edites `main`.
- No hagas push.
- Si el agente cambia el launcher, probá con `node bin/plain.js`, no solo con `plain`.
- Si cambia la extensión, reiniciá la sesión para cargar el código nuevo.
- Si cambia la policy, verificá que los tests de bloqueo sigan pasando.
- Si el cambio es high-risk, plan aprobado + review congelado.
- Al cerrar, dejá memoria de la decisión y el estado de la rama.

## Qué validar después

```bash
npm test
npm run check
npm run test:semantic
plain integrity
plain scratch list
plain doctor
```

Y una prueba manual:

```bash
plain
```

La sesión nueva debe abrir, crear su scratch y mostrar el estado del proyecto.

## Límites conocidos

- Sin sandbox del SO: la policy no contiene comandos arbitrarios.
- El cambio de la extensión no se aplica a la sesión que ya está corriendo.
- El estado central puede compartirse entre worktrees.
- `repo.bundle` del backup guarda commits, no archivos sin trackear.
- El scratch temporal no se respalda: es efímero.

## Criterio de éxito

El self-hosting sirve si podés:

1. volver a `main` sin perder estado;
2. reproducir el bug con un test;
3. aplicar el cambio con evidencia;
4. congelar y revisar el diff;
5. abrir la próxima sesión sin reparar nada a mano.
