# Tarea 03 — Cambio de contrato

**Tipo:** riesgosa  
**Riesgo:** high  
**Objetivo:** renombrar el campo público `priceCents` a `unitPriceCents`.

## Prompt para el agente

```text
Este proyecto está cambiando el contrato público de los ítems:
`priceCents` pasa a llamarse `unitPriceCents`.

Hacé el cambio en:
- `src/pricing.js`;
- tests;
- documentación.

No mantengas compatibilidad hacia atrás.
`lineTotal(priceCents, quantity)` mantiene su firma posicional.
`cartTotal(items)` debe leer `unitPriceCents`.
Al terminar, congelá el review y mostrá el diff.

Si usás Plain:
- creá la tarea con `risk: "high"`;
- mostrá el plan;
- usá `plain_task` con `action: "approve"` y esperá la aprobación humana antes de editar;
- al terminar, `plain review freeze`.
```

## Criterio de aceptación

- `cartTotal([{ unitPriceCents: 250, quantity: 2 }]) === 500`
- `lineTotal(250, 2) === 500`
- Los tests visibles usan `unitPriceCents`.
- La documentación menciona `unitPriceCents`.
- `npm test` pasa.
- Review congelado con `plain review freeze`.

## Test oculto

```bash
node bench/accept.mjs 03-risky bench/work/03-risky
```
