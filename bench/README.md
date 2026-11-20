# Bench — 3 tareas

Escenario mínimo para medir si Plain ayuda sin agregar veinte tareas.

## Qué mide

- aceptación en la primera pasada;
- tokens de entrada/salida/cache;
- tiempo;
- retrabajo;
- uso de `context_search`, checks y review.

## Tareas

| ID | Tipo | Qué prueba |
|---|---|---|
| `01-small` | chica | Validación acotada, un archivo |
| `02-medium` | mediana | Feature con tests y redondeo |
| `03-risky` | riesgosa | Cambio de contrato público + review congelado |

Cada tarea arranca del mismo fixture limpio. Los tests de aceptación están en `bench/acceptance/` y **no** se copian al workdir.

## Preparar

```bash
node bench/prepare.mjs
```

Crea:

```text
bench/work/01-small
bench/work/02-medium
bench/work/03-risky
```

Cada uno es un repo git con el fixture y un commit base.

Resetear una tarea:

```bash
node bench/prepare.mjs --reset 01-small
```

El reset borra el workdir **y** el estado central de ese proyecto
(`~/.plain/projects/<id>/`), incluyendo tareas, aprobaciones, reviews y eventos.
Así la próxima corrida arranca limpia.

## Correr una tarea

1. Abrí el prompt de `bench/tasks/<id>.md`.
2. Trabajá en `bench/work/<id>`.
3. Al terminar, corré el test oculto:

```bash
node bench/accept.mjs 01-small bench/work/01-small
```

## Variantes

### Baseline

```bash
cd bench/work/01-small
pi
```

Sin Plain, sin `context_search`, sin directivas. Mismo modelo y thinking level que la variante Plain.

### Plain

```bash
cd bench/work/01-small
plain
```

Usá `context_search` antes de editar y `plain_check` antes de cerrar.

Para `03-risky`:
- creá la tarea con `risk: "high"`;
- mostrá el plan;
- llamá `plain_task` con `action: "approve"` y esperá la aprobación humana;
- recién ahí editá;
- al terminar, `plain review freeze`.

No uses delegación en esta primera medición: así separás el efecto del contexto y los checks del efecto de los subagentes.

## Métricas

Anotá una fila por corrida:

| Tarea | Variante | Modelo | Tokens in | Tokens out | Cache | Tiempo | Aceptado | Retrabajo | Notas |
|---|---|---|---|---:|---:|---:|---:|---|---|---|
| 01-small | baseline |  |  |  |  |  | sí/no |  |  |
| 01-small | plain |  |  |  |  |  | sí/no |  |  |
| 02-medium | baseline |  |  |  |  |  | sí/no |  |  |
| 02-medium | plain |  |  |  |  |  | sí/no |  |  |
| 03-risky | baseline |  |  |  |  |  | sí/no |  |  |
| 03-risky | plain |  |  |  |  |  | sí/no |  |  |

## Reglas

- Mismo modelo y thinking level en baseline y Plain.
- Resetear el workdir antes de cada corrida.
- No abrir `bench/acceptance/` durante la tarea.
- Una corrida por variante primero; si hay diferencia grande, repetir 3 veces.
- No mezclar delegación con esta medición.

## Resultado esperado

No hace falta que Plain gane en las tres. Lo importante es ver:

- si la tarea chica no se vuelve más lenta;
- si la mediana acepta antes;
- si la riesgosa produce un review útil;
- cuánto contexto ahorra `context_search`.
