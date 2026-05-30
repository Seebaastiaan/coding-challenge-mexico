import type { ExchangeName } from "./types.js";

export const SYMBOL = "BTC/USDT" as const;
export const PORT = Number(process.env.PORT ?? 4000);
export const WEB_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:3000";
export const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 2_000);

export const RUNTIME_PROFILE = (process.env.RUNTIME_PROFILE ?? "paper-fast") as "paper-fast" | "sandbox-live" | "live";
export const EXECUTION_MODE = (process.env.EXECUTION_MODE ?? "paper") as "paper" | "sandbox" | "live";
export const ENABLE_LIVE_TRADING = process.env.ENABLE_LIVE_TRADING === "true";
export const ENABLE_SANDBOX_TRADING = process.env.ENABLE_SANDBOX_TRADING === "true";

export const SUPPORTED_EXCHANGES: ExchangeName[] = ["Binance", "Kraken", "OKX", "Bybit", "Coinbase"];
export const SUPPORTED_PAIRS = ["BTC/USDT", "BTC/USD", "BTC/USDC"] as const;

export const MIN_PROFIT = Number(process.env.MIN_PROFIT ?? 5);
export const MIN_SCORE = Number(process.env.MIN_SCORE ?? 70);
export const MIN_VOLUME_BTC = Number(process.env.MIN_VOLUME_BTC ?? 0.001);
export const MAX_LATENCY_MS = Number(process.env.MAX_LATENCY_MS ?? 1_000);
export const SIMULATION_VOLUME_BTC = Number(process.env.SIMULATION_VOLUME_BTC ?? 0.01);
export const MAX_LIVE_NOTIONAL_USDT = Number(process.env.MAX_LIVE_NOTIONAL_USDT ?? 1_000);
export const MAX_TRADES_PER_MINUTE = Number(process.env.MAX_TRADES_PER_MINUTE ?? 5);
export const MAX_RISK_CONSECUTIVE_LOSSES = Number(process.env.MAX_RISK_CONSECUTIVE_LOSSES ?? 3);
export const MAX_RISK_DRAWDOWN_USDT = Number(process.env.MAX_RISK_DRAWDOWN_USDT ?? 150);
export const MAX_INVENTORY_SKEW_RATIO = Number(process.env.MAX_INVENTORY_SKEW_RATIO ?? 0.45);
export const SLO_P95_MARKET_TO_DECISION_MS = Number(process.env.SLO_P95_MARKET_TO_DECISION_MS ?? 1_200);
export const SLO_P95_DECISION_TO_INTENT_MS = Number(process.env.SLO_P95_DECISION_TO_INTENT_MS ?? 250);
export const SLO_P95_INTENT_TO_RESULT_MS = Number(process.env.SLO_P95_INTENT_TO_RESULT_MS ?? 900);
export const SLO_BREACH_CONSECUTIVE_LIMIT = Number(process.env.SLO_BREACH_CONSECUTIVE_LIMIT ?? 2);
export const EXCHANGE_STALE_ALERT_MS = Number(process.env.EXCHANGE_STALE_ALERT_MS ?? 12_000);

export const EXCHANGE_FEES: Record<ExchangeName, number> = {
  Binance: 0.001,
  Kraken: 0.0026,
  OKX: 0.001,
  Bybit: 0.001,
  Coinbase: 0.004
};

export const INITIAL_BALANCES: Record<ExchangeName, { BTC: number; USDT: number }> = {
  Binance: { BTC: 1, USDT: 50_000 },
  Kraken: { BTC: 1, USDT: 50_000 },
  OKX: { BTC: 1, USDT: 50_000 },
  Bybit: { BTC: 1, USDT: 50_000 },
  Coinbase: { BTC: 1, USDT: 50_000 }
};
