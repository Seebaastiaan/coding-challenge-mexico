import type { MarketSnapshot } from "../types.js";
import type { MarketStreamConnector, MarketSnapshotHandler, StreamStatusHandler } from "./streamTypes.js";

const KRAKEN_WS_URL = "wss://ws.kraken.com/v2";
const STALE_MS = 6_000;

type KrakenBook = {
  bid: number;
  bid_qty: number;
  ask: number;
  ask_qty: number;
};

type KrakenTickerMessage = {
  channel?: string;
  type?: string;
  data?: KrakenBook[];
};

function parseSnapshot(message: KrakenTickerMessage): MarketSnapshot | null {
  if (message.channel !== "ticker" || !message.data?.length) {
    return null;
  }

  const ticker = message.data[0];

  return {
    exchange: "Kraken",
    symbol: "BTC/USDT",
    bestBid: Number(ticker.bid),
    bestAsk: Number(ticker.ask),
    bidVolume: Number(ticker.bid_qty),
    askVolume: Number(ticker.ask_qty),
    timestamp: Date.now(),
    source: "live"
  };
}

function createSubscribeMessage() {
  return JSON.stringify({
    method: "subscribe",
    params: {
      channel: "ticker",
      symbol: ["BTC/USDT"]
    }
  });
}

export function createKrakenStreamConnector(): MarketStreamConnector {
  return {
    exchange: "Kraken",
    start(onSnapshot: MarketSnapshotHandler, onStatus?: StreamStatusHandler) {
      let ws: WebSocket | null = null;
      let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
      let staleTimer: ReturnType<typeof setInterval> | null = null;
      let lastMessageAt = 0;
      let closed = false;
      let reconnectAttempts = 0;

      const clearTimers = () => {
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }

        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
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
        onStatus?.("Kraken", `ws reconnect scheduled in ${delayMs}ms`);

        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          connect();
        }, delayMs);
      };

      const connect = () => {
        if (closed) {
          return;
        }

        ws = new WebSocket(KRAKEN_WS_URL);

        ws.addEventListener("open", () => {
          reconnectAttempts = 0;
          lastMessageAt = Date.now();
          ws?.send(createSubscribeMessage());
          onStatus?.("Kraken", "ws connected and subscribed");

          if (!heartbeatTimer) {
            heartbeatTimer = setInterval(() => {
              if (!ws || ws.readyState !== WebSocket.OPEN) {
                return;
              }

              ws.send(JSON.stringify({ method: "ping" }));
            }, 15_000);
          }

          if (!staleTimer) {
            staleTimer = setInterval(() => {
              if (closed || !ws || ws.readyState !== WebSocket.OPEN) {
                return;
              }

              const age = Date.now() - lastMessageAt;
              if (age > STALE_MS) {
                onStatus?.("Kraken", `ws stale for ${age}ms, reconnecting`);
                ws.close();
              }
            }, 1_500);
          }
        });

        ws.addEventListener("message", (event) => {
          lastMessageAt = Date.now();

          try {
            const payload = JSON.parse(String(event.data)) as KrakenTickerMessage;
            if (payload.type === "error") {
              onStatus?.("Kraken", `ws error payload: ${String(event.data)}`);
              return;
            }

            const snapshot = parseSnapshot(payload);
            if (snapshot) {
              onSnapshot(snapshot);
            }
          } catch (error) {
            onStatus?.("Kraken", `ws payload parse error: ${error instanceof Error ? error.message : String(error)}`);
          }
        });

        ws.addEventListener("error", (event) => {
          onStatus?.("Kraken", `ws error: ${JSON.stringify(event)}`);
        });

        ws.addEventListener("close", () => {
          onStatus?.("Kraken", "ws closed");
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
