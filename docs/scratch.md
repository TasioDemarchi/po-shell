# Scratch temporal

Plain usa un scratch propiedad del runtime para scripts, pruebas y archivos descartables. El agente no decide libremente dónde ponerlos.

## Principio

> Lo temporal vive fuera del repo, en una ruta conocida, y lo borra el runtime.

## Rutas

Por defecto:

```text
~/.plain/tmp/
```

El launcher crea una sesión:

```text
~/.plain/tmp/plain-XXXXXX/
```

y apunta:

```text
TMPDIR
PLAIN_TMP
PLAIN_SCRATCH_ID
```

a ese directorio. En Windows también apunta `TMP` y `TEMP`.

Se puede cambiar la raíz con:

```bash
export PLAIN_TMP_ROOT=/ruta/temporal/plain
```

## Subagentes

Cada `plain_delegate` recibe su propio scratch:

```text
PLAIN_TMP/plain-sub-XXXXXX/
```

- se crea bajo el scratch de la sesión;
- el hijo hereda ese `TMPDIR`;
- el padre lo borra al terminar, incluso si falla;
- el hijo no borra su propio scratch.

## Ledger

El runtime guarda:

```text
~/.plain/tmp/ledger/<session-id>.json
```

Con:

```text
id, pid, startedAt, cwd
tempRoot, scratchDir
TMPDIR/TMP/TEMP heredados
```

El archivo se escribe atómico y con permisos privados.

## Limpieza

- Al cerrar la sesión: borra su scratch y el ledger.
- Al arrancar una sesión: barre ledgers de procesos muertos.
- El barrido espera una hora para no borrar un hijo que todavía puede estar usando el temp.
- `plain scratch list` muestra scratch vivos y terminados.
- `plain scratch clean` limpia los terminados; `--force` ignora la hora de gracia.
- Nunca borra un proceso vivo.

Antes de borrar verifica:

- que el nombre sea `plain-XXXXXX` o `plain-sub-XXXXXX`;
- que sea hijo directo del temp root registrado;
- que sea un directorio real, no symlink;
- que pertenezca al usuario actual.

## Reglas para el agente

- Scripts y pruebas descartables van en `PLAIN_TMP`/`TMPDIR`.
- No crear `tmp/`, `.tmp/` ni scripts temporales dentro del repo.
- Si una prueba debe quedar, se promueve a `test/` o `scripts/` con nombre y commit.
- Un test que necesite scratch debe usar `mktemp`, fuera del worktree.
- Un subagente reporta sus paths temporales; el padre limpia.

## Protección

Plain bloquea escribir tests que apunten `TMPDIR` al working directory, por ejemplo:

```text
TMPDIR=$PWD/.tmp
TMPDIR=./tmp
process.env.TMPDIR = path.join(process.cwd(), ".tmp")
```

También lo bloquea en subagentes. La protección ve `write`/`edit`; el contenido de un script escrito por `bash` queda fuera de ese chequeo.

## Qué queda para después

- Registrar clones y worktrees creados por la sesión y limpiarlos con confirmación.
- Quarantine de subagentes con salida no confirmada y token de inicio de proceso.
- Protección de `TMPDIR` también para comandos escritos por `bash`.
- Nombres cortos para sockets Unix en rutas profundas.
- Limpieza de caches de herramientas fuera de `PLAIN_TMP`.
- Barrido con más pruebas de Windows y sistemas de archivos sin permisos POSIX.

Hasta entonces, la regla operativa es:

```text
scratch fuera del repo
cleanup al cerrar
si es permanente, se promueve
```
