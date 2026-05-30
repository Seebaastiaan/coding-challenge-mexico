import type { MarketSnapshot } from "../types.js";
import type { MarketStreamConnector, MarketSnapshotHandler, StreamStatusHandler } from "./streamTypes.js";

const BINANCE_WS_URL = "wss://stream.binance.com:9443/ws/btcusdt@bookTicker";
const STALE_MS = 6_000;

type BinanceBookTickerPayload = {
  b: string;
  B: string;
  a: string;
  A: string;
};

function parseSnapshot(payload: BinanceBookTickerPayload): MarketSnapshot {
  return {
    exchange: "Binance",
    symbol: "BTC/USDT",
    bestBid: Number(payload.b),
    bestAsk: Number(payload.a),
    bidVolume: Number(payload.B),
    askVolume: Number(payload.A),
    timestamp: Date.now(),
    source: "live"
  };
}

export function createBinanceStreamConnector(): MarketStreamConnector {
  return {
    exchange: "Binance",
    start(onSnapshot: MarketSnapshotHandler, onStatus?: StreamStatusHandler) {
      let ws: WebSocket | null = null;
      let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
      let staleTimer: ReturnType<typeof setInterval> | null = null;
      let lastMessageAt = 0;
      let closed = false;
      let reconnectAttempts = 0;

      const clearTimers = () => {
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        if (staleTimer) {
          clearInterval(staleTimer);
          staleTimer = null;
        }
      };

      const scheduleReconnect = () => {
        if (closed || reconnectTimer) {
          return;
        }

        reconnectAttempts += 1;
        const backoffMs = Math.min(30_000, 500 * 2 ** Math.min(reconnectAttempts, 6));
        const jitterMs = Math.floor(Math.random() * 350);
        const delayMs = backoffMs + jitterMs;
        onStatus?.("Binance", `ws reconnect scheduled in ${delayMs}ms`);

        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          connect();
        }, delayMs);
      };

      const connect = () => {
        if (closed) {
          return;
        }

        ws = new WebSocket(BINANCE_WS_URL);

        ws.addEventListener("open", () => {
          reconnectAttempts = 0;
          lastMessageAt = Date.now();
          onStatus?.("Binance", "ws connected");

          if (!staleTimer) {
            staleTimer = setInterval(() => {
              if (closed || !ws || ws.readyState !== WebSocket.OPEN) {
                return;
              }

              const age = Date.now() - lastMessageAt;
              if (age > STALE_MS) {
                onStatus?.("Binance", `ws stale for ${age}ms, reconnecting`);
                ws.close();
              }
            }, 1_500);
          }
        });

        ws.addEventListener("message", (event) => {
          lastMessageAt = Date.now();

          try {
            const payload = JSON.parse(String(event.data)) as BinanceBookTickerPayload;
            onSnapshot(parseSnapshot(payload));
          } catch (error) {
            onStatus?.("Binance", `ws payload parse error: ${error instanceof Error ? error.message : String(error)}`);
          }
        });

        ws.addEventListener("error", (event) => {
          onStatus?.("Binance", `ws error: ${JSON.stringify(event)}`);
        });

        ws.addEventListener("close", () => {
          onStatus?.("Binance", "ws closed");
          ws = null;
          scheduleReconnect();
        });
      };

      connect();

      return () => {
        closed = true;
        clearTimers();
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
      };
    }
  };
}
