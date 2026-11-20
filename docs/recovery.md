# Recuperación e integridad

Este documento es el runbook de recuperación de Plain. Aplica al estado central en `~/.plain` y al repositorio.

## Principio

> Un backup no sirve si nunca se probó. Una recuperación no sirve si no es repetible.

Antes de una operación riesgosa:

```bash
plain backup
plain integrity
```

Operaciones riesgosas incluyen migraciones, cambios de schema, limpieza de estado, reindexado, restauración y cualquier tarea con `risk: high`.

## Qué guarda un backup

`plain backup` crea un directorio bajo:

```text
~/.plain/backups/<project-id>/<timestamp>/
```

Contiene:

```text
manifest.json        versión, proyecto, fecha y advertencias
state/               tasks, config, memoria, reviews y eventos
context.db           snapshot SQLite consistente
global-memory/       copia del espejo global, si existe
repo.bundle          historial Git, si el proyecto es un repo
```

`repo.bundle` incluye commits, no archivos sin trackear ni cambios sin commitear. Hacé commit antes de un backup importante.

El scratch efímero (`~/.plain/tmp/`) no se incluye: no es estado durable.

El directorio del backup se crea con permisos `0700` en sistemas POSIX.

## Comandos

```bash
plain backup                    # crear backup del proyecto actual
plain backup --output <dir>     # destino explícito
plain backup list               # backups del proyecto actual
plain backup list --all         # backups de todos los proyectos
plain restore <backup-dir> --yes
plain restore <backup-dir> --yes --no-db
plain restore <backup-dir> --yes --global
plain integrity
plain integrity --fix
plain integrity --json
```

`restore` requiere `--yes` y mueve el estado anterior a:

```text
~/.plain/trash/restore-<timestamp>/<project-id>/
```

Ese directorio es la red de seguridad inmediata.

## Verificación

```bash
plain integrity
```

Chequea:

- `config.json` y tareas JSON;
- fases válidas;
- `active` apuntando a una tarea existente;
- líneas corruptas en `events.jsonl`;
- hashes de reviews congelados;
- `PRAGMA integrity_check`;
- memorias Markdown que faltan o están desincronizadas respecto de SQLite.

Códigos:

- **ERROR**: no entregar ni seguir sin reparar.
- **WARN**: revisar; puede ser recuperable.

`plain integrity --fix` importa memorias Markdown que falten en SQLite. No sobrescribe memorias existentes ni borra filas.

## Escenarios

### 1. La DB SQLite está corrupta

1. Detené Plain.
2. Hacé un backup del estado actual si es legible:

```bash
plain backup --output ~/plain-emergency-$(date +%s)
```

3. Restaurá el último backup sano:

```bash
plain restore ~/.plain/backups/<project-id>/<timestamp> --yes
plain integrity
```

4. Si no hay backup, preservá `~/.plain` completo antes de tocar nada. No borres la DB sin copiarla.

### 2. Falta una memoria en SQLite pero existe el Markdown

```bash
plain integrity          # debe mostrar WARN memory mirror
plain integrity --fix
plain integrity
```

El fix solo inserta memorias faltantes. Si hay hashes distintos, revisalos a mano: el Markdown puede ser el mirror viejo.

### 3. Una tarea JSON está corrupta

1. No edites el JSON a ciegas.
2. Buscá el último `task.updated` en `events.jsonl`.
3. Restaurá el backup más cercano o reconstruí la tarea desde el evento.
4. Verificá:

```bash
plain integrity
plain status
```

`events.jsonl` es append-only y sirve como evidencia, no como replay automático.

### 4. Un review no coincide con su hash

```bash
plain integrity
```

No entregues ese cambio. Revisá el diff actual, confirmá que es lo esperado y volvé a congelar:

```bash
plain review freeze
```

### 5. Se perdió o corrompió el índice

```bash
plain index --rebuild
```

El rebuild preserva las memorias canónicas. No borra `context.db` ni el estado de tareas.

### 6. Se perdió el repositorio

Si el backup tiene `repo.bundle`:

```bash
git clone ~/.plain/backups/<project-id>/<timestamp>/repo.bundle <destino>
```

Los archivos sin commitear no están en el bundle. Recuperalos desde el working tree o desde otro backup.

### 7. Se perdió la sesión de Pi

La sesión `.jsonl` es de Pi, no de Plain. Plain guarda:

- `session/current` antes de compactar;
- tareas y evidencia en `~/.plain/projects/<id>/`;
- memoria durable;
- `docs/features/<slug>.md` cuando corresponde.

Para retomar: abrí la sesión desde su ruta, leé `plain status` y buscá `session/current` con `context_search`.

## Restore selectivo

- `--no-db`: no toca `context.db`; útil para recuperar solo tareas, reviews o config.
- `--global`: restaura también `global-memory/`; por defecto no se toca para no pisar otros proyectos.
- Sin flags: restaura estado del proyecto y el snapshot completo de la DB.

## Seguridad del backup

- El backup puede contener memorias y eventos internos. No lo subas a un repo ni a la nube sin cifrarlo.
- No guardes secretos en tareas, memoria, eventos ni backups.
- `repo.bundle` contiene todo el historial de commits; tratalo como al repositorio.
- La policy no es un sandbox. Un backup no reemplaza el aislamiento del sistema operativo.

## Checklist después de recuperar

```text
[ ] plain integrity
[ ] plain status
[ ] plain index
[ ] plain context search "<tema>" para verificar memoria
[ ] revisar tarea activa y próximo paso
[ ] correr el check del proyecto
[ ] commit de estado si corresponde
```
