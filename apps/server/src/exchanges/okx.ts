import type { MarketSnapshot } from "../types.js";
import type { MarketSnapshotHandler, MarketStreamConnector, StreamStatusHandler } from "./streamTypes.js";

const OKX_WS_URL = "wss://ws.okx.com:8443/ws/v5/public";
const STALE_MS = 6_000;

type OkxBooksMessage = {
  event?: string;
  msg?: string;
  data?: Array<{
    bids?: string[][];
    asks?: string[][];
    ts?: string;
  }>;
};

function createSubscribeMessage() {
  return JSON.stringify({
    op: "subscribe",
    args: [{ channel: "books5", instId: "BTC-USDT" }]
  });
}

function parseSnapshot(payload: OkxBooksMessage): MarketSnapshot | null {
  const book = payload.data?.[0];
  const bid = book?.bids?.[0];
  const ask = book?.asks?.[0];

  if (!bid || !ask) {
    return null;
  }

  const timestamp = Number(book?.ts);

  return {
    exchange: "OKX",
    symbol: "BTC/USDT",
    bestBid: Number(bid[0]),
    bestAsk: Number(ask[0]),
    bidVolume: Number(bid[1]),
    askVolume: Number(ask[1]),
    timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
    source: "live"
  };
}

export function createOkxStreamConnector(): MarketStreamConnector {
  return {
    exchange: "OKX",
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
        onStatus?.("OKX", `ws reconnect scheduled in ${delayMs}ms`);

        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          connect();
        }, delayMs);
      };

      const connect = () => {
        if (closed) {
          return;
        }

        ws = new WebSocket(OKX_WS_URL);

        ws.addEventListener("open", () => {
          reconnectAttempts = 0;
          lastMessageAt = Date.now();
          ws?.send(createSubscribeMessage());
          onStatus?.("OKX", "ws connected and subscribed");

          if (!heartbeatTimer) {
            heartbeatTimer = setInterval(() => {
              if (!ws || ws.readyState !== WebSocket.OPEN) {
                return;
              }
              ws.send("ping");
            }, 15_000);
          }

          if (!staleTimer) {
            staleTimer = setInterval(() => {
              if (closed || !ws || ws.readyState !== WebSocket.OPEN) {
                return;
              }

              const age = Date.now() - lastMessageAt;
              if (age > STALE_MS) {
                onStatus?.("OKX", `ws stale for ${age}ms, reconnecting`);
                ws.close();
              }
            }, 1_500);
          }
        });

        ws.addEventListener("message", (event) => {
          lastMessageAt = Date.now();

          if (String(event.data) === "pong") {
            return;
          }

          try {
            const payload = JSON.parse(String(event.data)) as OkxBooksMessage;
            if (payload.event === "error") {
              onStatus?.("OKX", `ws error payload: ${payload.msg ?? String(event.data)}`);
              return;
            }

            const snapshot = parseSnapshot(payload);
            if (snapshot) {
              onSnapshot(snapshot);
            }
          } catch (error) {
            onStatus?.("OKX", `ws payload parse error: ${error instanceof Error ? error.message : String(error)}`);
          }
        });

        ws.addEventListener("error", (event) => {
          onStatus?.("OKX", `ws error: ${JSON.stringify(event)}`);
        });

        ws.addEventListener("close", () => {
          onStatus?.("OKX", "ws closed");
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
