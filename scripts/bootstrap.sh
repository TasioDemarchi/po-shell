#!/bin/sh
# Bootstrap de po-shell de una máquina nueva a un arnés andando.
#
# Orden fijo: preflight (Node 22+, git, npm, nunca root), validación del backup,
# `scripts/install.sh`, restore y verificación. Sin --from no restaura nada.
# El `--yes` del restore lo da el humano al invocar este script: no restauramos
# estado porque sí.
#
# Uso:
#   sh scripts/bootstrap.sh                                   # instala y verifica
#   sh scripts/bootstrap.sh --from ~/po-shell-migracion        # directorio de backup
#   sh scripts/bootstrap.sh --from ~/po-shell-migracion.tar.gz # paquete tar.gz
#   sh scripts/bootstrap.sh --from https://…/po-shell.tar.gz   # paquete por URL
#   sh scripts/bootstrap.sh --from … --no-restore              # instala y verifica
#
# No corre con sudo, no baja binarios y no ejecuta nada remoto: la URL la pasás
# vos y se baja con curl.
set -eu

fail() {
  printf 'bootstrap.sh: %s\n' "$1" >&2
  exit 1
}

usage() {
  cat <<'TXT'
Uso: sh scripts/bootstrap.sh [--from <directorio|archivo.tar.gz|URL>] [--no-restore]

Instala po-shell en una máquina nueva y, si le pasás un backup, restaura su
estado sobre este checkout. Modos:

  1) sin --from        Preflight, `scripts/install.sh` y verificación. Nunca
                       restaura: sirve para una máquina nueva sin estado.

  2) --from <origen>   Instala, restaura y verifica. <origen> puede ser:
                       - un directorio de backup: se usa tal cual;
                       - un archivo .tar.gz: se extrae a un directorio temporal
                         (se borra al salir, con trap);
                       - una URL: se baja con curl -fLo a ese mismo temporal.
                       En los tres casos tiene que haber un manifest.json.

  3) --no-restore      Instala y verifica, pero no restaura aunque haya --from.

Opciones:
  --from <origen>   backup a restaurar: directorio, archivo .tar.gz o URL
  --no-restore      no restaura, aunque se haya pasado --from
  --help, -h        este texto

El restore se corre como `po-shell restore <dir> --yes --global --no-db`. Ese --yes lo
das vos al invocar este comando (o al pasar --from): el script no decide
restaurar por su cuenta, y sin --from no hay restore. El estado restaurado es el
de este checkout, no el del directorio desde donde invocás el script.

La base de datos del backup no se restaura porque pertenece a la identidad del
proyecto viejo (su id cambia cuando cambian el origin o la ruta). El índice de
docs y el espejo de memoria se reconstruyen desde el estado con
`index --rebuild`, y el ledger de costos arranca de cero.

No corre con sudo ni como root y no ejecuta nada remoto: no hay pasos ocultos.
TXT
}

root=$(CDPATH= cd -P "$(dirname "$0")/.." && pwd) || fail 'no puedo ubicar la raíz del repo'

from=''
restore=1
while [ $# -gt 0 ]; do
  case $1 in
    --from)
      [ $# -ge 2 ] || fail '--from necesita <directorio|archivo.tar.gz|URL>'
      from=$2
      shift
      ;;
    --from=*)
      from=${1#--from=}
      [ -n "$from" ] || fail '--from necesita <directorio|archivo.tar.gz|URL>'
      ;;
    --no-restore) restore=0 ;;
    --help | -h)
      usage
      exit 0
      ;;
    *) fail "opción desconocida: $1" ;;
  esac
  shift
done

# El temporal del .tar.gz o de la URL se borra siempre, incluso si abortamos a
# mitad de camino.
tmp=''
cleanup() {
  if [ -n "$tmp" ] && [ -d "$tmp" ]; then
    rm -rf "$tmp"
  fi
}
trap cleanup EXIT HUP INT TERM

# ---------------------------------------------------------------------------
# 1. Preflight. Falla con qué falta, no con un stack trace, y nunca con sudo:
# po-shell escribe en tu $HOME.
if [ "$(id -u)" -eq 0 ]; then
  fail 'no corras esto con sudo ni como root: po-shell escribe en tu $HOME, no en /root'
fi

command -v node >/dev/null 2>&1 || fail 'falta Node. po-shell necesita Node 22+'
node_version=$(node -v 2>/dev/null) || fail 'no pude leer la versión de Node (node -v)'
case $node_version in
  v*) ;;
  *) fail "no entiendo la versión de Node: $node_version" ;;
esac
node_major=${node_version#v}
node_major=${node_major%%.*}
case $node_major in
  '' | *[!0-9]*) fail "no entiendo la versión de Node: $node_version" ;;
esac
[ "$node_major" -ge 22 ] || fail "Node $node_version es viejo: po-shell necesita Node 22+"

command -v git >/dev/null 2>&1 || fail 'falta git'
command -v npm >/dev/null 2>&1 || fail 'falta npm (se usa para la instalación)'
printf 'bootstrap.sh: preflight OK · node %s · git · npm\n' "$node_version"

# ---------------------------------------------------------------------------
# 2. Validación del backup, antes de tocar nada.
backup_dir=''

# Extrae $2 dentro de $1/paquete y deja en $backup_dir el directorio que tiene
# manifest.json. El manifest puede estar en la raíz del paquete o hasta tres
# niveles adentro: `tar czf po-shell-migracion.tar.gz po-shell-migracion` deja
# po-shell-migracion/backup/manifest.json. Gana el nivel más superficial; si hay
# más de uno en ese nivel no adivino, aborto.
extract_into() {
  target=$1/paquete
  mkdir -p "$target" || fail "no pude crear $target"
  tar -xzf "$2" -C "$target" || fail "no pude extraer $2"

  matches=''
  depth=0
  while [ "$depth" -le 3 ]; do
    matches=$(find "$target" -mindepth "$depth" -maxdepth "$depth" -name manifest.json)
    if [ -n "$matches" ]; then
      break
    fi
    depth=$((depth + 1))
  done
  [ -n "$matches" ] || fail "el paquete $2 no trae manifest.json"

  count=$(printf '%s\n' "$matches" | wc -l | tr -d ' ')
  if [ "$count" -gt 1 ]; then
    first=$(printf '%s\n' "$matches" | head -n 1)
    second=$(printf '%s\n' "$matches" | head -n 2 | tail -n 1)
    fail "el paquete $2 trae $count manifest.json en el mismo nivel y no sé cuál restaurar: $first y $second"
  fi

  backup_dir=$(dirname "$matches")
}

if [ -n "$from" ]; then
  # Mismo criterio que `po-shell restore`: acepta ~/ruta, no $VARIABLES.
  case $from in
    "~/"*) from=$HOME/${from#"~/"} ;;
  esac
  case $from in
    http://* | https://*)
      command -v curl >/dev/null 2>&1 ||
        fail "falta curl para bajar $from: instalá curl o bajá el .tar.gz y pasá la ruta"
      tmp=$(mktemp -d) || fail 'no puedo crear un directorio temporal'
      printf 'bootstrap.sh: bajando %s\n' "$from"
      curl -fLo "$tmp/paquete.tar.gz" "$from" || fail "no pude bajar $from"
      extract_into "$tmp" "$tmp/paquete.tar.gz"
      ;;
    *)
      if [ -d "$from" ]; then
        backup_dir=$from
      elif [ -f "$from" ]; then
        case $from in
          *.tar.gz | *.tgz) ;;
          *) fail "el backup $from no es un .tar.gz (pasá un directorio, un .tar.gz o una URL)" ;;
        esac
        tmp=$(mktemp -d) || fail 'no puedo crear un directorio temporal'
        extract_into "$tmp" "$from"
      else
        fail "no existe el backup: $from"
      fi
      ;;
  esac

  [ -f "$backup_dir/manifest.json" ] ||
    fail "el backup $from no tiene manifest.json (no es un directorio de po-shell backup)"
  backup_dir=$(CDPATH= cd -P "$backup_dir" && pwd) || fail "no puedo resolver $backup_dir"

  # Nombre del proyecto y fecha de creación, para que se vea qué se va a
  # restaurar antes de que pase nada.
  backup_info=$(
    node -e '
const fs = require("node:fs");
let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
} catch {
  process.exit(1);
}
const project = manifest.project || {};
const name = project.name || project.id || "sin nombre";
const created = manifest.createdAt || "sin fecha";
process.stdout.write(name + " · " + created);
' "$backup_dir/manifest.json" 2>/dev/null
  ) || fail "manifest.json ilegible en $backup_dir"
  printf 'bootstrap.sh: backup OK · %s\n' "$backup_info"
fi

# ---------------------------------------------------------------------------
# po-shell puede no estar en PATH todavía en una máquina nueva: cae al bin del
# repo, igual que install.sh.
po_shell() {
  if command -v po-shell >/dev/null 2>&1; then
    po-shell "$@"
  else
    node "$root/bin/po-shell.js" "$@"
  fi
}

# El estado sobre el que trabajamos es el de este checkout, no el del directorio
# desde el que se invocó el script.
run_root() {
  (cd "$root" && "$@")
}

# ---------------------------------------------------------------------------
# 3. Instalación: no duplico lógica, install.sh ya hace npm link + doctor.
printf 'bootstrap.sh: instalando con scripts/install.sh\n'
sh "$root/scripts/install.sh" || fail 'scripts/install.sh falló'

# ---------------------------------------------------------------------------
# 4. Restore. El --yes es del humano: lo dio al pasar --from.
restored=0
if [ -z "$backup_dir" ]; then
  printf 'bootstrap.sh: sin backup, no restauro nada\n'
elif [ "$restore" = 0 ]; then
  printf 'bootstrap.sh: --no-restore, salteo el restore de %s\n' "$backup_dir"
else
  printf 'bootstrap.sh: restaurando desde %s\n' "$backup_dir"
  run_root po_shell restore "$backup_dir" --yes --global --no-db || fail 'po-shell restore falló'
  restored=1
fi

# ---------------------------------------------------------------------------
# 5. Verificación. Primero se reindexa, así integrity mira el índice recién
# reconstruido y no el que vino (o no vino) en el backup.
printf 'bootstrap.sh: reindexando\n'
run_root po_shell index --rebuild || fail 'po-shell index --rebuild falló'

verification=0
if ! run_root po_shell integrity; then
  if [ "$restored" = 1 ]; then
    printf 'bootstrap.sh: integrity falló después del restore: no sigas.\n' >&2
    printf 'bootstrap.sh: qué mirar, paso a paso: docs/recovery.md\n' >&2
    exit 1
  fi
  printf 'bootstrap.sh: integrity falló, pero no hubo restore (proyecto sin estado todavía).\n' >&2
  printf 'bootstrap.sh: si no es un proyecto nuevo, mirá docs/recovery.md\n' >&2
  verification=1
fi

# doctor y status son diagnóstico: muestran, no deciden. El que decide es
# integrity, arriba.
run_root po_shell doctor || printf 'bootstrap.sh: doctor reportó fallas (mirá arriba)\n' >&2
run_root po_shell status || printf 'bootstrap.sh: status no pudo leer el estado (mirá arriba)\n' >&2

if [ "$verification" = 1 ]; then
  printf 'bootstrap.sh: listo, con integrity pendiente.\n'
else
  printf 'bootstrap.sh: listo.\n'
fi
