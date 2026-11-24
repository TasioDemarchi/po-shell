# Self-hosting

po-shell puede usarse para mejorar po-shell. Eso es dogfooding: el arnés trabaja sobre su propio código.

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
po-shell integrity
po-shell backup
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
git worktree add ../po-shell-selfhost -b test/selfhost
cd ../po-shell-selfhost
```

po-shell identifica un proyecto por su remote o root. Un worktree puede compartir el estado central con el repo principal: no tengas dos sesiones escribiendo tareas o memoria al mismo tiempo.

Si agregás un remote, el id calculado cambia. Para no perder estado, el kernel **adopta** el directorio que ya existe para ese root (`adoptStateId`). Si ves un id nuevo con `inicializado: no`, corré `po-shell where`: debería resolver al estado viejo. El procedimiento manual está en `docs/recovery.md`. Un proceso de Pi ya abierto cachea la identidad; el valor nuevo se usa desde la próxima sesión.

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

Si `po-shell` deja de abrir:

```bash
node bin/po-shell.js doctor
node bin/po-shell.js integrity
node bin/po-shell.js help
```

También podés volver al tag:

```bash
git switch main
git switch -c fix/launcher
```

Y restaurar estado:

```bash
po-shell restore <backup-dir> --yes
po-shell integrity
```

## Reglas para la sesión de self-hosting

- Un cambio pequeño por tarea.
- Cada cambio de kernel o policy necesita test.
- Antes de tocar estado, backup + integrity.
- No edites `main`.
- No hagas push.
- Si el agente cambia el launcher, probá con `node bin/po-shell.js`, no solo con `po-shell`.
- Si cambia la extensión, reiniciá la sesión para cargar el código nuevo.
- Si cambia la policy, verificá que los tests de bloqueo sigan pasando.
- Si el cambio es high-risk, plan aprobado + review congelado.
- Al cerrar, dejá memoria de la decisión y el estado de la rama.

## Qué validar después

```bash
npm test
npm run check
npm run test:semantic
po-shell integrity
po-shell scratch list
po-shell doctor
```

Y una prueba manual:

```bash
po-shell
```

La sesión nueva debe abrir, crear su scratch y mostrar el estado del proyecto.

## Límites conocidos

- Sin sandbox del SO: la policy reconoce formas destructivas conocidas y no es un intérprete de shell.
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
