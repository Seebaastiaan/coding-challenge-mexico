# BTC Arbitrage Radar

## Descripción general

**BTC Arbitrage Radar** es una web app que monitorea en tiempo real el mercado de **BTC/USDT** en diferentes exchanges, detecta oportunidades de arbitraje y simula operaciones de compra y venta de manera inteligente.

La solución combina dos enfoques:

1. Un **MVP sólido y funcional**, capaz de conectarse a exchanges reales, leer precios en tiempo real y simular arbitraje.
2. Un **sistema inteligente de scoring**, que no solo detecta oportunidades, sino que las evalúa según rentabilidad, liquidez, slippage, fees, latencia y riesgo.

El objetivo no es ejecutar trading real, sino demostrar una arquitectura robusta para detectar, evaluar y simular oportunidades de arbitraje con datos de mercado reales.

---

## Problemática

Bitcoin se negocia simultáneamente en múltiples exchanges alrededor del mundo. Como cada exchange tiene su propio libro de órdenes, liquidez y usuarios, el precio de BTC puede variar ligeramente entre plataformas.

Estas diferencias de precio crean oportunidades de arbitraje.

Por ejemplo:

- En un exchange, BTC puede estar disponible para comprar a **$70,000**.
- En otro exchange, BTC puede estar disponible para vender a **$70,250**.

En teoría, se podría comprar barato y vender caro. Sin embargo, en la práctica se deben considerar:

- Fees de compra y venta.
- Slippage.
- Liquidez disponible.
- Latencia de red.
- Riesgo de que el precio cambie antes de ejecutar.
- Balances disponibles en cada exchange.

Por eso, una oportunidad aparentemente rentable puede terminar siendo negativa si no se evalúa correctamente.

---

## Propuesta de solución

La solución propuesta es una aplicación llamada **BTC Arbitrage Radar**, que funciona como un simulador inteligente de arbitraje de Bitcoin.

La aplicación monitorea en tiempo real el precio de BTC/USDT en al menos dos exchanges, detecta diferencias entre el mejor precio de compra y el mejor precio de venta, calcula la rentabilidad neta y simula la ejecución de operaciones únicamente cuando la oportunidad supera un umbral mínimo de rentabilidad y calidad.

---

## Objetivo principal

Construir una web app capaz de:

- Monitorear order books de BTC/USDT en tiempo real.
- Detectar oportunidades de arbitraje entre exchanges.
- Calcular rentabilidad neta después de costos.
- Simular operaciones de compra y venta.
- Manejar balances ficticios por exchange.
- Registrar oportunidades y trades ejecutados.
- Mostrar métricas de rendimiento en un dashboard.
- Asignar un score inteligente a cada oportunidad.

---

## Alcance del MVP

Para la primera versión se propone trabajar con:

- **Binance**
- **Kraken**
- Par de trading: **BTC/USDT**
- Modo: **simulación**
- Sin ejecución real de órdenes
- Dashboard web en tiempo real

---

## Arquitectura general

```txt
[Exchange WebSockets]
        ↓
[Market Data Service]
        ↓
[Arbitrage Engine]
        ↓
[Scoring Engine]
        ↓
[Execution Simulator]
        ↓
[Database]
        ↓
[Next.js Dashboard]
```

---

## Componentes principales

### 1. Market Data Service

Este módulo se encarga de conectarse a los exchanges mediante WebSockets o polling.

Su responsabilidad es mantener actualizado el mejor precio de compra y venta de cada exchange.

Datos principales:

```ts
type MarketSnapshot = {
  exchange: string;
  symbol: string;
  bestBid: number;
  bestAsk: number;
  bidVolume: number;
  askVolume: number;
  timestamp: number;
};
```

Ejemplo:

```json
{
  "exchange": "Binance",
  "symbol": "BTC/USDT",
  "bestBid": 70240,
  "bestAsk": 70250,
  "bidVolume": 1.4,
  "askVolume": 2.1,
  "timestamp": 1710000000000
}
```

---

### 2. Arbitrage Engine

Este módulo compara los precios entre exchanges.

La condición básica para detectar una oportunidad es:

```txt
ask_exchange_A < bid_exchange_B
```

Esto significa:

- Comprar BTC en el exchange A.
- Vender BTC en el exchange B.

Ejemplo:

```txt
Comprar en Kraken: 70,000 USDT
Vender en Binance: 70,250 USDT
Spread bruto: 250 USDT
```

---

### 3. Profit Calculator

Este módulo calcula si la oportunidad es rentable después de costos.

Fórmula simplificada:

```txt
profit_neto = ingreso_venta - costo_compra - fees - slippage - costos_extra
```

Ejemplo:

```txt
Compra:
1 BTC × 70,000 = 70,000 USDT
Fee compra 0.1% = 70 USDT
Costo total = 70,070 USDT

Venta:
1 BTC × 70,250 = 70,250 USDT
Fee venta 0.1% = 70.25 USDT
Ingreso neto = 70,179.75 USDT

Profit neto:
70,179.75 - 70,070 = 109.75 USDT
```

---

### 4. Scoring Engine

Este módulo evalúa la calidad de cada oportunidad.

No basta con que el profit sea positivo. También se debe medir el riesgo.

Factores del score:

| Factor | Descripción |
|---|---|
| Profit neto | Ganancia real después de costos |
| Liquidez | Volumen disponible en el order book |
| Slippage | Pérdida estimada por mover el precio |
| Latencia | Tiempo desde la última actualización |
| Spread | Diferencia entre precio de compra y venta |
| Riesgo | Probabilidad de que la oportunidad desaparezca |

Ejemplo de fórmula:

```txt
score = profit_neto - penalizacion_slippage - penalizacion_latencia - penalizacion_liquidez
```

Ejemplo de interpretación:

| Score | Decisión |
|---:|---|
| 80 - 100 | Ejecutar simulación |
| 50 - 79 | Observar |
| 0 - 49 | Ignorar |

---

### 5. Execution Simulator

Este módulo simula la operación.

Cuando se detecta una oportunidad válida:

1. Compra BTC en el exchange con menor Ask.
2. Vende BTC en el exchange con mayor Bid.
3. Resta fees.
4. Ajusta balances ficticios.
5. Registra la operación.
6. Actualiza el P&L acumulado.

Ejemplo de balances iniciales:

```json
{
  "Binance": {
    "BTC": 1,
    "USDT": 50000
  },
  "Kraken": {
    "BTC": 1,
    "USDT": 50000
  }
}
```

Después de una operación simulada, los balances se actualizan como si la operación hubiera ocurrido realmente.

---

### 6. Risk Manager

Este módulo evita ejecutar simulaciones en escenarios peligrosos.

Reglas sugeridas:

- No operar si el profit neto es menor a un umbral mínimo.
- No operar si la latencia es muy alta.
- No operar si la liquidez disponible es insuficiente.
- No operar si el spread desaparece antes de simular.
- No operar si el slippage estimado supera la ganancia.
- Activar un circuit breaker si hay demasiadas pérdidas consecutivas.

Ejemplo:

```txt
Si hay 3 operaciones negativas consecutivas:
    pausar simulaciones durante 60 segundos
```

---

## Flujo de funcionamiento

```txt
1. El sistema recibe precios en tiempo real desde los exchanges.
2. Actualiza el mejor Bid y Ask de cada exchange.
3. Compara todos los exchanges conectados.
4. Detecta si existe una oportunidad de arbitraje.
5. Calcula el profit neto.
6. Evalúa la oportunidad con el Scoring Engine.
7. Si el score es suficiente, simula la operación.
8. Actualiza balances.
9. Guarda la operación en la base de datos.
10. Muestra resultados en el dashboard.
```

---

## Dashboard web

La interfaz debe mostrar información clara y en tiempo real.

Secciones sugeridas:

### Market Overview

Tabla con precios actuales:

| Exchange | Best Bid | Best Ask | Spread |
|---|---:|---:|---:|
| Binance | 70,240 | 70,250 | 10 |
| Kraken | 70,260 | 70,270 | 10 |

---

### Arbitrage Opportunities

Tabla de oportunidades detectadas:

| Comprar en | Vender en | Profit neto | Score | Estado |
|---|---|---:|---:|---|
| Kraken | Binance | 109.75 USDT | 87 | Ejecutada |
| Binance | Kraken | 12.40 USDT | 43 | Ignorada |

---

### Simulated Trades

Historial de operaciones simuladas:

| Fecha | Compra | Venta | Volumen | Profit |
|---|---|---|---:|---:|
| 2026-05-29 12:30 | Kraken | Binance | 0.25 BTC | 27.43 USDT |

---

### Performance

Métricas principales:

- P&L acumulado.
- Número de oportunidades detectadas.
- Número de trades simulados.
- Win rate.
- Profit promedio por trade.
- Mejor operación.
- Peor operación.
- Exchanges con más oportunidades.

---

## Stack tecnológico recomendado

### Frontend

- Next.js
- React
- TypeScript
- Tailwind CSS
- shadcn/ui
- Recharts

### Backend

- Node.js
- TypeScript
- WebSockets
- Express o Fastify
- Socket.IO para enviar datos al frontend

### Base de datos

Opción simple:

- SQLite

Opción más robusta:

- PostgreSQL

### Deploy

- Frontend: Vercel
- Backend: Railway, Render o Fly.io
- Base de datos: Supabase, Neon o Railway PostgreSQL

---

## Estructura sugerida del proyecto

```txt
btc-arbitrage-radar/
├── apps/
│   ├── web/
│   │   ├── app/
│   │   ├── components/
│   │   ├── hooks/
│   │   └── lib/
│   │
│   └── server/
│       ├── src/
│       │   ├── exchanges/
│       │   ├── services/
│       │   ├── engine/
│       │   ├── simulator/
│       │   ├── database/
│       │   └── index.ts
│
├── packages/
│   ├── arbitrage-core/
│   └── shared-types/
│
├── README.md
├── docker-compose.yml
└── package.json
```

---

## Modelos de datos

### Opportunity

```ts
type Opportunity = {
  id: string;
  buyExchange: string;
  sellExchange: string;
  symbol: string;
  buyPrice: number;
  sellPrice: number;
  volume: number;
  grossProfit: number;
  netProfit: number;
  fees: number;
  slippage: number;
  latencyMs: number;
  score: number;
  status: "detected" | "executed" | "ignored";
  createdAt: Date;
};
```

### Trade

```ts
type Trade = {
  id: string;
  opportunityId: string;
  buyExchange: string;
  sellExchange: string;
  volume: number;
  buyPrice: number;
  sellPrice: number;
  netProfit: number;
  executedAt: Date;
};
```

### WalletBalance

```ts
type WalletBalance = {
  exchange: string;
  BTC: number;
  USDT: number;
};
```

---

## Lógica de decisión

Una oportunidad se ejecuta en modo simulación solo si cumple:

```txt
profit_neto > MIN_PROFIT
score > MIN_SCORE
liquidez_disponible >= volumen_minimo
latencia < MAX_LATENCY
slippage < profit_neto
```

Valores iniciales sugeridos:

```ts
const MIN_PROFIT = 5;
const MIN_SCORE = 70;
const MIN_VOLUME_BTC = 0.001;
const MAX_LATENCY_MS = 1000;
```

---

## Roadmap de desarrollo

### Fase 1: MVP básico

- Crear proyecto Next.js.
- Crear backend con Node.js.
- Conectar WebSocket de Binance.
- Conectar WebSocket o polling de Kraken.
- Mostrar precios en tiempo real.
- Detectar diferencias Ask/Bid.

### Fase 2: Cálculo de rentabilidad

- Agregar fees por exchange.
- Calcular profit bruto.
- Calcular profit neto.
- Estimar slippage básico.
- Agregar threshold mínimo de profit.

### Fase 3: Simulación de ejecución

- Crear balances ficticios.
- Simular compra y venta.
- Actualizar balances.
- Registrar trades.
- Calcular P&L acumulado.

### Fase 4: Scoring inteligente

- Crear fórmula de score.
- Penalizar baja liquidez.
- Penalizar alta latencia.
- Penalizar slippage.
- Clasificar oportunidades en ejecutar, observar o ignorar.

### Fase 5: Dashboard final

- Tabla de exchanges.
- Tabla de oportunidades.
- Historial de trades.
- Métricas de rendimiento.
- Gráfica de P&L acumulado.

### Fase 6: Deploy y presentación

- Deploy del frontend.
- Deploy del backend.
- Configurar variables de entorno.
- Crear README final.
- Preparar demo para jurado.

---

## Diferenciadores de la solución

Esta solución destaca porque no solo detecta diferencias de precio, sino que también evalúa la calidad real de cada oportunidad.

Diferenciadores principales:

- Uso de datos reales de mercado.
- Simulación sin riesgo financiero.
- Cálculo de profit neto.
- Consideración de fees, slippage y latencia.
- Sistema de scoring inteligente.
- Dashboard claro para visualizar rendimiento.
- Arquitectura modular y escalable.

---

## Posibles mejoras futuras

- Agregar más exchanges.
- Comparar múltiples pares además de BTC/USDT.
- Implementar arbitraje triangular.
- Usar Redis para procesamiento de datos en tiempo real.
- Agregar alertas por Telegram o Discord.
- Crear modo replay con datos históricos.
- Entrenar un modelo simple para predecir si una oportunidad desaparecerá rápido.
- Agregar backtesting.
- Implementar paper trading más realista.

---

## Pitch corto

**BTC Arbitrage Radar** es un simulador inteligente de arbitraje de Bitcoin que monitorea precios reales en múltiples exchanges, detecta oportunidades de compra y venta, calcula rentabilidad neta considerando costos reales y ejecuta operaciones simuladas con gestión de riesgo.

La solución permite visualizar en tiempo real el mercado, las oportunidades detectadas, los trades simulados y el rendimiento acumulado desde una interfaz web clara y funcional.

---

## Frase para presentación

> No buscamos detectar cualquier diferencia de precio. Buscamos detectar oportunidades realmente ejecutables, rentables y con riesgo controlado.
