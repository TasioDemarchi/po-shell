# Resultados

**Modelo:** GLM 5.3 Flash  
**Fecha:** 2026-11-19  
**Nota:** los tiempos son los reportados en la interfaz.

## Corridas

| Tarea | Variante | Arriba | Abajo | Tiempo | Aceptado | Notas |
|---|---|---:|---:|---:|---|---|
| 01-small | Pi | 17k | 9.9k | 24s | sí | Baseline |
| 01-small | Plain | 6.9k | 841 | 30s | sí | -59% input |
| 02-medium | Pi | 28k | 1.8k | 48s | sí | Baseline |
| 02-medium | Plain (1) | 8.6k | 1.9k | 57s | no | 1 test falló |
| 02-medium | Plain (2) | 8.8k | 1.9k | 59s | sí | Reintento |
| 03-risky | Pi | 21k | 881 | 22s | sí | Baseline |
| 03-risky | Plain (1) | 23k | 2.4k | 59s | sí | Aprobación por texto + UI, flujo duplicado |
| 03-risky | Plain (2) | 9.7k | 1.9k | 60s | sí | Solo UI; 60s sin contar la espera humana |

## Lectura rápida

- Input: Plain usa ~59-69% menos contexto en 01 y 02.
- 03-risky corregido: 9.7k input y 1.9k output. La corrida anterior (23k) incluía el ida y vuelta de aprobación por texto.
- 03-risky tarda ~60s sin contar la aprobación humana; Pi tardó 22s. El costo es el plan + check + review.
- Aceptación: Pi 3/3; Plain 4/5 (el fallo de 02 pasó al reintentar).
- Tiempo: Plain es más lento, sobre todo en 03 por el gate.
- n bajo: hace falta repetir 02 y 03.

## Costo aproximado

Precios GLM 5.3 Flash: input 5.25, output 17.50 créditos / 1M.  
Sin separar cache:

| Corrida | Costo aprox. |
|---|---:|
| 01 Pi | ~0.263 cr |
| 01 Plain | ~0.051 cr |
| 02 Pi | ~0.179 cr |
| 02 Plain (2) | ~0.079 cr |
| 03 Pi | ~0.126 cr |
| 03 Plain (1) | ~0.163 cr |
| 03 Plain (2) | ~0.084 cr |

Total Pi: ~0.568 cr.  
Total Plain (con 02 y 03 exitosos, sin contar el intento fallido): ~0.214 cr.  
Ahorro global: ~62%.  
La corrida corregida de 03-risky también ahorra ~33% frente a Pi.

## Problema de UX en 03

El agente pidió la aprobación por texto y después generó el choice.
Eso duplica el paso y agrega contexto.

Regla nueva: el plan se muestra, pero **la aprobación se pide únicamente con**:

```text
plain_task action="approve"
```

El selector de UI es la aprobación. No se pide “aprobás?” por chat.
