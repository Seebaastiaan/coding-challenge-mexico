import type { MarketSnapshot } from "../types.js";
import type { MarketSnapshotHandler, MarketStreamConnector, StreamStatusHandler } from "./streamTypes.js";

const BYBIT_WS_URL = "wss://stream.bybit.com/v5/public/spot";
const STALE_MS = 6_000;

type BybitOrderBookMessage = {
  topic?: string;
  type?: "snapshot" | "delta";
  ts?: number;
  data?: {
    b?: string[][];
    a?: string[][];
  };
};

function createSubscribeMessage() {
  return JSON.stringify({
    op: "subscribe",
    args: ["orderbook.50.BTCUSDT"]
  });
}

function sortedLevelsFromMap(levels: Map<string, string>, side: "bid" | "ask") {
  return [...levels.entries()]
    .filter(([, size]) => Number(size) > 0)
    .sort((a, b) => (side === "bid" ? Number(b[0]) - Number(a[0]) : Number(a[0]) - Number(b[0])))
    .slice(0, 1);
}

function applyLevels(target: Map<string, string>, levels: string[][] | undefined, reset: boolean) {
  if (reset) {
    target.clear();
  }

  for (const [price, size] of levels ?? []) {
    if (Number(size) === 0) {
      target.delete(price);
    } else {
      target.set(price, size);
    }
  }
}

function parseSnapshot(
  payload: BybitOrderBookMessage,
  bidsByPrice: Map<string, string>,
  asksByPrice: Map<string, string>
): MarketSnapshot | null {
  if (payload.topic !== "orderbook.50.BTCUSDT" || !payload.data) {
    return null;
  }

  const reset = payload.type === "snapshot";
  applyLevels(bidsByPrice, payload.data.b, reset);
  applyLevels(asksByPrice, payload.data.a, reset);

  const bid = sortedLevelsFromMap(bidsByPrice, "bid")[0];
  const ask = sortedLevelsFromMap(asksByPrice, "ask")[0];

  if (!bid || !ask) {
    return null;
  }

  return {
    exchange: "Bybit",
    symbol: "BTC/USDT",
    bestBid: Number(bid[0]),
    bestAsk: Number(ask[0]),
    bidVolume: Number(bid[1]),
    askVolume: Number(ask[1]),
    timestamp: Number.isFinite(payload.ts) ? Number(payload.ts) : Date.now(),
    source: "live"
  };
}

export function createBybitStreamConnector(): MarketStreamConnector {
  return {
    exchange: "Bybit",
    start(onSnapshot: MarketSnapshotHandler, onStatus?: StreamStatusHandler) {
      let ws: WebSocket | null = null;
      let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
      let staleTimer: ReturnType<typeof setInterval> | null = null;
      let lastMessageAt = 0;
      let closed = false;
      let reconnectAttempts = 0;
      const bidsByPrice = new Map<string, string>();
      const asksByPrice = new Map<string, string>();

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
        onStatus?.("Bybit", `ws reconnect scheduled in ${delayMs}ms`);

        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          connect();
        }, delayMs);
      };

      const connect = () => {
        if (closed) {
          return;
        }

        bidsByPrice.clear();
        asksByPrice.clear();
        ws = new WebSocket(BYBIT_WS_URL);

        ws.addEventListener("open", () => {
          reconnectAttempts = 0;
          lastMessageAt = Date.now();
          ws?.send(createSubscribeMessage());
          onStatus?.("Bybit", "ws connected and subscribed");

          if (!staleTimer) {
            staleTimer = setInterval(() => {
              if (closed || !ws || ws.readyState !== WebSocket.OPEN) {
                return;
              }

              const age = Date.now() - lastMessageAt;
              if (age > STALE_MS) {
                onStatus?.("Bybit", `ws stale for ${age}ms, reconnecting`);
                ws.close();
              }
            }, 1_500);
          }
        });

        ws.addEventListener("message", (event) => {
          lastMessageAt = Date.now();

          try {
            const payload = JSON.parse(String(event.data)) as BybitOrderBookMessage;
            const snapshot = parseSnapshot(payload, bidsByPrice, asksByPrice);
            if (snapshot) {
              onSnapshot(snapshot);
            }
          } catch (error) {
            onStatus?.("Bybit", `ws payload parse error: ${error instanceof Error ? error.message : String(error)}`);
          }
        });

        ws.addEventListener("error", (event) => {
          onStatus?.("Bybit", `ws error: ${JSON.stringify(event)}`);
        });

        ws.addEventListener("close", () => {
          onStatus?.("Bybit", "ws closed");
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
