import type { ExchangeName, MarketSnapshot } from "../types.js";

export type MarketSnapshotHandler = (snapshot: MarketSnapshot) => void;

export type StreamStatusHandler = (exchange: ExchangeName, message: string) => void;

export type MarketStreamConnector = {
  exchange: ExchangeName;
  start: (onSnapshot: MarketSnapshotHandler, onStatus?: StreamStatusHandler) => () => void;
};
