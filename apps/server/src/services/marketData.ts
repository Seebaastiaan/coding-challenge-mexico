import { createBinanceStreamConnector } from "../exchanges/binance.js";
import { createBybitStreamConnector } from "../exchanges/bybit.js";
import { createCoinbaseStreamConnector } from "../exchanges/coinbase.js";
import { createKrakenStreamConnector } from "../exchanges/kraken.js";
import { createOkxStreamConnector } from "../exchanges/okx.js";
import type { MarketStreamConnector } from "../exchanges/streamTypes.js";
import { SUPPORTED_EXCHANGES } from "../config.js";
import type { ExchangeName, MarketSnapshot } from "../types.js";

const fallbackBase = 70_000;

type SnapshotCallback = (snapshots: MarketSnapshot[]) => void;
type StatusCallback = (exchange: ExchangeName, message: string) => void;

function fallbackSnapshot(exchange: ExchangeName, offset: number): MarketSnapshot {
  const drift = Math.sin(Date.now() / 15_000 + offset) * 22;
  const mid = fallbackBase + drift + offset * 18;

  return {
    exchange,
    symbol: "BTC/USDT",
    bestBid: Number((mid - 5).toFixed(2)),
    bestAsk: Number((mid + 5).toFixed(2)),
    bidVolume: Number((0.25 + Math.random() * 1.8).toFixed(4)),
    askVolume: Number((0.25 + Math.random() * 1.8).toFixed(4)),
    timestamp: Date.now(),
    source: "fallback"
  };
}

async function krakenRestFallbackSnapshot(): Promise<MarketSnapshot | null> {
  const response = await fetch("https://api.kraken.com/0/public/Ticker?pair=XBTUSDT");
  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as unknown;
  if (!payload || typeof payload !== "object" || !("result" in payload)) {
    return null;
  }

  const result = (payload as { result?: Record<string, unknown> }).result;
  const ticker = result?.XBTUSDT;
  if (!ticker || typeof ticker !== "object") {
    return null;
  }

  const ask = (ticker as { a?: unknown }).a;
  const bid = (ticker as { b?: unknown }).b;
  if (!Array.isArray(ask) || !Array.isArray(bid) || !ask[0] || !bid[0]) {
    return null;
  }

  return {
    exchange: "Kraken",
    symbol: "BTC/USDT",
    bestBid: Number(bid[0]),
    bestAsk: Number(ask[0]),
    bidVolume: Number(bid[1] ?? 0.15),
    askVolume: Number(ask[1] ?? 0.15),
    timestamp: Date.now(),
    source: "fallback"
  };
}

async function createFallbackSnapshot(exchange: ExchangeName, offset: number): Promise<MarketSnapshot> {
  if (exchange === "Kraken") {
    const restSnapshot = await krakenRestFallbackSnapshot();
    if (restSnapshot) {
      return restSnapshot;
    }
  }

  return fallbackSnapshot(exchange, offset);
}

export function createMarketDataStream(onSnapshot: SnapshotCallback, onStatus?: StatusCallback) {
  const connectors: MarketStreamConnector[] = [
    createBinanceStreamConnector(),
    createKrakenStreamConnector(),
    createCoinbaseStreamConnector(),
    createOkxStreamConnector(),
    createBybitStreamConnector()
  ];
  const latestByExchange = new Map<ExchangeName, MarketSnapshot>();
  let fallbackTimer: ReturnType<typeof setInterval> | null = null;

  const bootstrapFallbacks = SUPPORTED_EXCHANGES.map((exchange, index) => fallbackSnapshot(exchange, index));
  for (const snapshot of bootstrapFallbacks) {
    latestByExchange.set(snapshot.exchange, snapshot);
    onSnapshot([snapshot]);
  }

  const stopFunctions = connectors.map((connector) =>
    connector.start(
      (snapshot) => {
        latestByExchange.set(snapshot.exchange, snapshot);
        onSnapshot([snapshot]);
      },
      (exchange, message) => {
        console.warn(`[market-data] ${exchange}: ${message}`);
        onStatus?.(exchange, message);
      }
    )
  );

  fallbackTimer = setInterval(() => {
    const now = Date.now();

    for (const [exchange, snapshot] of latestByExchange.entries()) {
      if (now - snapshot.timestamp > 6_000) {
        const offset = SUPPORTED_EXCHANGES.indexOf(exchange);
        void createFallbackSnapshot(exchange, offset).then((fallback) => {
          latestByExchange.set(exchange, fallback);
          onSnapshot([fallback]);
        }).catch((error) => {
          onStatus?.(exchange, `fallback refresh failed: ${error instanceof Error ? error.message : String(error)}`);
        });
      }
    }
  }, 2_000);

  return () => {
    for (const stop of stopFunctions) {
      stop();
    }

    if (fallbackTimer) {
      clearInterval(fallbackTimer);
      fallbackTimer = null;
    }
  };
}
