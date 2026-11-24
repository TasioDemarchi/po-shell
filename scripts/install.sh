#!/bin/sh
# Bootstrap de po-shell desde un checkout.
#
# Verifica Node 22+, git y npm, enlaza el paquete con `npm link` y corre
# `po-shell doctor`. No corre con sudo, no baja binarios y no ejecuta nada
# remoto: todo lo que hace se puede leer acá.
#
# Uso:
#   sh scripts/install.sh                     # verifica y enlaza
#   sh scripts/install.sh --no-link           # solo verifica
#   sh scripts/install.sh --alias po-shell-test  # enlaza y crea un comando con otro nombre
#
# --alias sirve para probar una rama o un worktree sin tocar el `po-shell` de
# main: el comando nuevo apunta al bin/po-shell.js de ESTE checkout, y
# PACKAGE_ROOT se resuelve desde src/shell.js, así que sesión, extensión,
# skills y protocolo salen de acá.
set -eu

fail() {
  printf 'install.sh: %s\n' "$1" >&2
  exit 1
}

root=$(CDPATH= cd -P "$(dirname "$0")/.." && pwd) || fail 'no puedo ubicar la raíz del repo'
link=1
alias_name=''
while [ $# -gt 0 ]; do
  case $1 in
    --no-link) link=0 ;;
    --alias)
      [ $# -ge 2 ] || fail '--alias necesita un nombre'
      alias_name=$2
      shift
      ;;
    --alias=*)
      alias_name=${1#--alias=}
      ;;
    --help | -h)
      printf '%s\n' "Uso: sh scripts/install.sh [--no-link] [--alias <nombre>]"
      exit 0
      ;;
    *) fail "opción desconocida: $1" ;;
  esac
  shift
done

# Un alias nunca corre npm link: eso re-apuntaría el `po-shell` global a este
# checkout, que es justo lo que `--alias` evita.
if [ -n "$alias_name" ] && [ "$link" = 1 ]; then
  printf 'install.sh: --alias no corre npm link; el comando global queda como estaba.\n'
  link=0
fi

command -v node >/dev/null 2>&1 || fail 'falta Node. po-shell necesita Node 22+'
node -e 'const m = Number(process.versions.node.split(".")[0]); process.exit(m >= 22 ? 0 : 1)' ||
  fail "Node $(node -v) es viejo: po-shell necesita Node 22+"

command -v git >/dev/null 2>&1 || fail 'falta git'
command -v npm >/dev/null 2>&1 || fail 'falta npm (se usa para npm link)'

if ! command -v pi >/dev/null 2>&1 && [ -z "${PO_SHELL_PI_BIN:-}" ]; then
  printf '%s\n' "install.sh: Pi no está en PATH." >&2
  printf '%s\n' "  Instalalo con: npm i -g @earendil-works/pi-coding-agent" >&2
  printf '%s\n' "  O apuntá a un binario: export PO_SHELL_PI_BIN=/ruta/a/pi" >&2
fi

if [ "$link" = 1 ]; then
  printf 'install.sh: npm link en %s\n' "$root"
  (cd "$root" && npm link --silent) || fail 'npm link falló'
fi

if [ -n "$alias_name" ]; then
  case $alias_name in
    */* | '' ) fail "--alias no acepta rutas: $alias_name" ;;
  esac
  bindir=''
  if linked=$(command -v po-shell 2>/dev/null); then
    bindir=$(dirname "$linked")
  fi
  if [ -z "$bindir" ]; then
    prefix=$(npm prefix -g 2>/dev/null || true)
    [ -n "$prefix" ] || fail 'no puedo ubicar el directorio de binarios de npm'
    bindir=$prefix/bin
  fi
  [ -d "$bindir" ] || fail "no existe el directorio de binarios: $bindir"
  if ln -sf "$root/bin/po-shell.js" "$bindir/$alias_name" 2>/dev/null; then
    printf 'install.sh: %s -> %s/bin/po-shell.js\n' "$bindir/$alias_name" "$root"
    printf 'install.sh: %s usa este checkout; `po-shell` sigue apuntando a donde estaba.\n' "$alias_name"
  else
    fail "no pude crear $bindir/$alias_name (¿permisos?). Probá sin sudo: ln -sf \"$root/bin/po-shell.js\" \"$bindir/$alias_name\""
  fi
fi

node "$root/bin/po-shell.js" doctor
