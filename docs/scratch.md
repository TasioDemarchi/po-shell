# Scratch temporal

po-shell usa un scratch propiedad del runtime para scripts, pruebas y archivos descartables. El agente no decide libremente dónde ponerlos.

## Principio

> Lo temporal vive fuera del repo, en una ruta conocida, y lo borra el runtime.

## Rutas

Por defecto:

```text
~/.po-shell/tmp/
```

El launcher crea una sesión:

```text
~/.po-shell/tmp/po-shell-XXXXXX/
```

y apunta:

```text
TMPDIR
PO_SHELL_TMP
PO_SHELL_SCRATCH_ID
```

a ese directorio. En Windows también apunta `TMP` y `TEMP`.

Se puede cambiar la raíz con:

```bash
export PO_SHELL_TMP_ROOT=/ruta/temporal/po-shell
```

## Subagentes

Cada `po_shell_delegate` recibe su propio scratch:

```text
PO_SHELL_TMP/po-shell-sub-XXXXXX/
```

- se crea bajo el scratch de la sesión;
- el hijo hereda ese `TMPDIR`;
- el padre lo borra al terminar, incluso si falla;
- el hijo no borra su propio scratch.

## Ledger

El runtime guarda:

```text
~/.po-shell/tmp/ledger/<session-id>.json
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
- `po-shell scratch list` muestra scratch vivos y terminados.
- `po-shell scratch clean` limpia los terminados; `--force` ignora la hora de gracia.
- Nunca borra un proceso vivo.

Antes de borrar verifica:

- que el nombre sea `po-shell-XXXXXX` o `po-shell-sub-XXXXXX`;
- que sea hijo directo del temp root registrado;
- que sea un directorio real, no symlink;
- que pertenezca al usuario actual.

## Reglas para el agente

- Scripts y pruebas descartables van en `PO_SHELL_TMP`/`TMPDIR`.
- No crear `tmp/`, `.tmp/` ni scripts temporales dentro del repo.
- Si una prueba debe quedar, se promueve a `test/` o `scripts/` con nombre y commit.
- Un test que necesite scratch debe usar `mktemp`, fuera del worktree.
- Un subagente reporta sus paths temporales; el padre limpia.

## Protección

po-shell bloquea escribir tests que apunten `TMPDIR` al working directory, por ejemplo:

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
- Limpieza de caches de herramientas fuera de `PO_SHELL_TMP`.
- Barrido con más pruebas de Windows y sistemas de archivos sin permisos POSIX.

Hasta entonces, la regla operativa es:

```text
scratch fuera del repo
cleanup al cerrar
si es permanente, se promueve
```
