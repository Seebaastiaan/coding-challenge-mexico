import type { MarketSnapshot } from "../types.js";
import type { MarketSnapshotHandler, MarketStreamConnector, StreamStatusHandler } from "./streamTypes.js";

const COINBASE_WS_URL = "wss://ws-feed.exchange.coinbase.com";
const STALE_MS = 6_000;

type CoinbaseTickerMessage = {
  type?: string;
  product_id?: string;
  best_bid?: string;
  best_ask?: string;
  best_bid_size?: string;
  best_ask_size?: string;
};

function createSubscribeMessage() {
  return JSON.stringify({
    type: "subscribe",
    product_ids: ["BTC-USD"],
    channels: ["ticker"]
  });
}

function parseSnapshot(payload: CoinbaseTickerMessage): MarketSnapshot | null {
  if (payload.type !== "ticker" || payload.product_id !== "BTC-USD" || !payload.best_bid || !payload.best_ask) {
    return null;
  }

  return {
    exchange: "Coinbase",
    symbol: "BTC/USDT",
    bestBid: Number(payload.best_bid),
    bestAsk: Number(payload.best_ask),
    bidVolume: Number(payload.best_bid_size ?? 0.12),
    askVolume: Number(payload.best_ask_size ?? 0.12),
    timestamp: Date.now(),
    source: "live"
  };
}

export function createCoinbaseStreamConnector(): MarketStreamConnector {
  return {
    exchange: "Coinbase",
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
        onStatus?.("Coinbase", `ws reconnect scheduled in ${delayMs}ms`);

        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          connect();
        }, delayMs);
      };

      const connect = () => {
        if (closed) {
          return;
        }

        ws = new WebSocket(COINBASE_WS_URL);

        ws.addEventListener("open", () => {
          reconnectAttempts = 0;
          lastMessageAt = Date.now();
          ws?.send(createSubscribeMessage());
          onStatus?.("Coinbase", "ws connected and subscribed");

          if (!staleTimer) {
            staleTimer = setInterval(() => {
              if (closed || !ws || ws.readyState !== WebSocket.OPEN) {
                return;
              }

              const age = Date.now() - lastMessageAt;
              if (age > STALE_MS) {
                onStatus?.("Coinbase", `ws stale for ${age}ms, reconnecting`);
                ws.close();
              }
            }, 1_500);
          }
        });

        ws.addEventListener("message", (event) => {
          lastMessageAt = Date.now();

          try {
            const payload = JSON.parse(String(event.data)) as CoinbaseTickerMessage;
            const snapshot = parseSnapshot(payload);
            if (snapshot) {
              onSnapshot(snapshot);
            }
          } catch (error) {
            onStatus?.("Coinbase", `ws payload parse error: ${error instanceof Error ? error.message : String(error)}`);
          }
        });

        ws.addEventListener("error", (event) => {
          onStatus?.("Coinbase", `ws error: ${JSON.stringify(event)}`);
        });

        ws.addEventListener("close", () => {
          onStatus?.("Coinbase", "ws closed");
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
