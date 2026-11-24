#!/bin/sh
# Bootstrap de po-shell desde un checkout.
#
# Verifica Node 22+, git y npm, enlaza el paquete con `npm link` y corre
# `po-shell doctor`. No corre con sudo, no baja binarios y no ejecuta nada
# remoto: todo lo que hace se puede leer acá.
#
# Uso:
#   sh scripts/install.sh            # verifica y enlaza
#   sh scripts/install.sh --no-link  # solo verifica
set -eu

fail() {
  printf 'install.sh: %s\n' "$1" >&2
  exit 1
}

root=$(CDPATH= cd -P "$(dirname "$0")/.." && pwd) || fail 'no puedo ubicar la raíz del repo'
link=1
for arg in "$@"; do
  case $arg in
    --no-link) link=0 ;;
    --help | -h)
      printf '%s\n' "Uso: sh scripts/install.sh [--no-link]"
      exit 0
      ;;
    *) fail "opción desconocida: $arg" ;;
  esac
done

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

node "$root/bin/po-shell.js" doctor
