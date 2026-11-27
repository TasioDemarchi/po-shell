---
type: feature
status: active
---

# Feature: de una notebook a otra en un comando

Risk: high

## Outcome

Que instalar el arnés en una máquina nueva con todo su estado sea un comando, y que ese comando no
pueda destruir un estado existente por accidente:

```bash
git clone https://github.com/TasioDemarchi/po-shell.git ~/dev/po-shell
cd ~/dev/po-shell && sh scripts/bootstrap.sh --from ~/po-shell-migracion.tar.gz
```

Hoy `scripts/install.sh` instala pero no restaura, y `po-shell restore` es explícito a propósito. La
pieza que falta es la que une las dos cosas sin esconder la decisión.

## Pain

Migrar a mano son seis pasos en los que es fácil equivocarse de orden: instalar, restaurar, verificar,
reindexar, comprobar credenciales y —la trampa que ya conocemos— dejar `origin` apuntando a un
`repo.bundle` y crear un proyecto vacío con otro id. Un script con el orden fijo y una verificación al
final convierte seis decisiones en una.

## Design

`scripts/bootstrap.sh`, POSIX sh como `install.sh`, sin dependencias nuevas:

1. **Preflight**: Node 22+, git, npm. Falla con un mensaje que dice qué falta, no un stack.
2. **Instalación**: corre `scripts/install.sh` (npm link + doctor), sin duplicar su lógica.
3. **Paquete**: `--from <ruta|archivo.tar.gz|URL>`. Una ruta a un directorio de backup se usa tal cual;
   un `.tar.gz` se extrae a `mktemp -d` con limpieza por `trap`; una URL se baja con `curl` si existe.
   El directorio final tiene que tener `manifest.json`, o el script aborta antes de tocar estado.
4. **Restore**: `po-shell restore <dir> --yes --global`. El `--yes` es del script y está documentado en
   su `--help`: el humano lo dio al invocar el comando, no lo da el script por su cuenta.
5. **Verificación**: `po-shell integrity` (falla el script si no da OK, con puntero a
   `docs/recovery.md`), `po-shell index --rebuild`, `po-shell doctor` y `po-shell status`.
6. **Sin `--from`**: solo instala y verifica. Así sirve también para una máquina nueva sin estado.

Guardas: nunca corre con `sudo`, nunca escribe fuera de `$HOME` salvo el backup indicado, mueve el
estado anterior a la papelera de `po-shell` (no borra), y el `--help` explica los tres modos.

## Units

- [ ] **U1 — El script.** `scripts/bootstrap.sh` con los tres modos, preflight, `trap` de limpieza y
      verificación final.
- [ ] **U2 — La sintaxis en los checks.** `sh -n scripts/bootstrap.sh` en `npm run check`, y un test
      que corra `--help` y verifique que documenta los modos.
- [ ] **U3 — La guía.** `README.md` con la sección de migración y el orden de los pasos.

## Out of scope

- Un repositorio de estado o artefactos cifrados: el paquete se lleva a mano.
- Cambiar `install.sh` o `restore` para que sean más automáticos: el script los orquesta.
- Sincronización automática entre máquinas.
