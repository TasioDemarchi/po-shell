# Tarea 02 — Descuentos

**Tipo:** mediana  
**Riesgo:** medium  
**Objetivo:** agregar descuento por porcentaje.

## Prompt para el agente

```text
Agregá `applyDiscount(cents, percent)` y extendé `cartTotal`.

Reglas:
- `cents` es un entero en centavos;
- `percent` es un número entre 0 y 100;
- el redondeo es half-up;
- `cartTotal(items, { discountPercent = 0 } = {})` aplica el descuento al subtotal;
- un porcentaje inválido lanza `RangeError`.

Agregá tests y actualizá la documentación del proyecto si hace falta.
No cambies el contrato de los ítems.
```

## Criterio de aceptación

- `applyDiscount(1000, 10) === 900`
- `applyDiscount(995, 10) === 896`
- `applyDiscount(1000, 0) === 1000`
- `applyDiscount(1000, 100) === 0`
- `cartTotal(items, { discountPercent: 10 })` descuenta el subtotal
- `applyDiscount(1000, -1)` y `applyDiscount(1000, 101)` lanzan `RangeError`
- `npm test` pasa.

## Test oculto

```bash
node bench/accept.mjs 02-medium bench/work/02-medium
```
