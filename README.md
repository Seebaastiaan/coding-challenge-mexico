# BTC Arbitrage Radar

Real-time BTC/USDT arbitrage simulator for Binance and Kraken. The app polls exchange order-book tickers, scores arbitrage opportunities after fees/slippage/latency, simulates eligible trades against fictitious balances, and streams the dashboard state with Socket.IO.

## Stack

- `apps/server`: Node.js, Express, Socket.IO, TypeScript
- `apps/web`: Next.js, React, TypeScript, Recharts
- Mode: simulation only, no real order execution

## Run Locally

```bash
npm install
npm run dev
```

Open:

- Web dashboard: `http://localhost:3000`
- Server health: `http://localhost:4000/health`
- Server state: `http://localhost:4000/state`

## Configuration

The server works without environment variables. Optional values:

```bash
PORT=4000
WEB_ORIGIN=http://localhost:3000
POLL_INTERVAL_MS=2000
MIN_PROFIT=5
MIN_SCORE=70
MIN_VOLUME_BTC=0.001
MAX_LATENCY_MS=1000
SIMULATION_VOLUME_BTC=0.01
```

For the web app:

```bash
NEXT_PUBLIC_SERVER_URL=http://localhost:4000
```

## Implemented Scope

- Live BTC/USDT market snapshots from Binance and Kraken using public REST endpoints.
- Fallback synthetic snapshots if an exchange request fails, so demos keep running.
- Arbitrage detection using `ask_exchange_A < bid_exchange_B`.
- Net profit calculation with exchange fees and estimated slippage.
- Intelligent scoring for profit, spread, liquidity, latency, and slippage risk.
- Risk rules for minimum profit, score, liquidity, latency, and slippage.
- Simulated execution with fictitious per-exchange BTC/USDT balances.
- In-memory opportunity/trade history and performance metrics.
- Dashboard with market overview, top signal, P&L, balances, opportunities, and trades.

## Important Notes

- This is a simulator and does not submit real orders.
- Data is kept in memory for hackathon/demo simplicity. Add SQLite or Postgres if durable history is required.
- Binance may block public API access from some locations. When that happens, the server marks snapshots as fallback data.
