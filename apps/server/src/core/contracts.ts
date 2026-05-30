import type { ExchangeName, MarketSnapshot, Opportunity } from "../types.js";

export type RuntimeProfile = "paper-fast" | "sandbox-live" | "live";

export type TradingPair = "BTC/USDT" | "BTC/USD" | "BTC/USDC";

export type MarketDataEvent = {
  kind: "market.book_top";
  exchange: ExchangeName;
  pair: TradingPair;
  snapshot: MarketSnapshot;
  observedAtMs: number;
  source: "ws" | "rest" | "fallback";
};

export type OpportunityEvent = {
  kind: "opportunity.detected";
  opportunity: Opportunity;
  detectedAtMs: number;
  decisionLatencyMs: number;
};

export type RiskDecisionEvent = {
  kind: "risk.decision";
  opportunityId: string;
  approved: boolean;
  reason: string;
  decidedAtMs: number;
};

export type ExecutionIntentEvent = {
  kind: "execution.intent";
  opportunityId: string;
  buyExchange: ExchangeName;
  sellExchange: ExchangeName;
  pair: TradingPair;
  volume: number;
  intentAtMs: number;
  mode: "paper" | "sandbox" | "live";
};

export type ExecutionResultEvent = {
  kind: "execution.result";
  opportunityId: string;
  success: boolean;
  status: "acked" | "filled" | "partially_filled" | "rejected" | "canceled" | "timeout";
  message: string;
  exchangeOrderId?: string;
  completedAtMs: number;
};

export type HealthEvent = {
  kind: "system.health";
  profile: RuntimeProfile;
  healthy: boolean;
  details: string;
  atMs: number;
};

export type InternalEvent =
  | MarketDataEvent
  | OpportunityEvent
  | RiskDecisionEvent
  | ExecutionIntentEvent
  | ExecutionResultEvent
  | HealthEvent;

export type InternalEventKind = InternalEvent["kind"];

export type InternalEventOf<K extends InternalEventKind> = Extract<InternalEvent, { kind: K }>;
