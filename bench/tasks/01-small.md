# Tarea 01 — Validación de cantidades

**Tipo:** chica  
**Riesgo:** low  
**Objetivo:** endurecer `parseQuantity`.

## Prompt para el agente

```text
En este proyecto, `parseQuantity` debe aceptar solo cantidades enteras positivas.
Hoy acepta cualquier cosa que `Number()` pueda convertir.

Cambiá `parseQuantity` para que:
- devuelva un entero cuando el valor es válido;
- lance `RangeError` para cero, negativos, decimales, texto inválido, `NaN` o `Infinity`.

Actualizá o agregá los tests que correspondan.
No cambies el resto de la API.
```

## Criterio de aceptación

- `parseQuantity("3") === 3`
- `parseQuantity("2.5")` lanza `RangeError`
- `parseQuantity("0")` lanza `RangeError`
- `parseQuantity("-1")` lanza `RangeError`
- `parseQuantity("abc")` lanza `RangeError`
- `npm test` pasa en el fixture.

## Test oculto

```bash
node bench/accept.mjs 01-small bench/work/01-small
```
