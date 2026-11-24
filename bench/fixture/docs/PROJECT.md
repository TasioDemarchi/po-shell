# po-shell Bench Fixture

Mini proyecto de precios para medir el arnés po-shell.

## Reglas

- Todos los precios se guardan en **centavos enteros**.
- Las cantidades son **enteros positivos**.
- La moneda es USD.
- No se usa punto flotante para dinero.
- `cartTotal(items)` devuelve centavos.
- El contrato inicial de un ítem es `{ priceCents, quantity }`.

## Comandos

```bash
npm test
```
