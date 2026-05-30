import type { InternalEvent } from "../core/contracts.js";
import type { ExchangeName } from "../types.js";

type LatencySeries = {
  values: number[];
  maxSize: number;
};

type ExchangeHealth = {
  connected: boolean;
  lastMessage: string;
  lastUpdateAt: number;
  reconnects: number;
  errors: number;
  stale: number;
};

type Percentiles = {
  p50: number;
  p95: number;
  p99: number;
  count: number;
};

export type TelemetrySnapshot = {
  counters: {
    opportunitiesDetected: number;
    executionResultsTotal: number;
    riskApprovedTotal: number;
    riskRejectedTotal: number;
    marketEventsWs: number;
    marketEventsFallback: number;
    marketEventsRest: number;
    executionStatusTotals: Record<string, number>;
  };
  latencyMs: {
    marketToDecision: Percentiles;
    decisionToIntent: Percentiles;
    intentToResult: Percentiles;
  };
  exchangeHealth: Record<ExchangeName, ExchangeHealth>;
};

const EXCHANGES: ExchangeName[] = ["Binance", "Kraken", "OKX", "Bybit", "Coinbase"];

function createSeries(maxSize = 2_000): LatencySeries {
  return {
    values: [],
    maxSize
  };
}

function observe(series: LatencySeries, value: number) {
  if (!Number.isFinite(value) || value < 0) {
    return;
  }

  series.values.push(Number(value.toFixed(3)));
  if (series.values.length > series.maxSize) {
    series.values.shift();
  }
}

function quantile(values: number[], q: number) {
  if (!values.length) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * q) - 1));
  return Number(sorted[index].toFixed(3));
}

function summarize(series: LatencySeries): Percentiles {
  return {
    p50: quantile(series.values, 0.5),
    p95: quantile(series.values, 0.95),
    p99: quantile(series.values, 0.99),
    count: series.values.length
  };
}

function initExchangeHealth(): Record<ExchangeName, ExchangeHealth> {
  return {
    Binance: { connected: false, lastMessage: "init", lastUpdateAt: 0, reconnects: 0, errors: 0, stale: 0 },
    Kraken: { connected: false, lastMessage: "init", lastUpdateAt: 0, reconnects: 0, errors: 0, stale: 0 },
    OKX: { connected: false, lastMessage: "init", lastUpdateAt: 0, reconnects: 0, errors: 0, stale: 0 },
    Bybit: { connected: false, lastMessage: "init", lastUpdateAt: 0, reconnects: 0, errors: 0, stale: 0 },
    Coinbase: { connected: false, lastMessage: "init", lastUpdateAt: 0, reconnects: 0, errors: 0, stale: 0 }
  };
}

export function createTelemetry() {
  const marketToDecision = createSeries();
  const decisionToIntent = createSeries();
  const intentToResult = createSeries();
  const exchangeHealth = initExchangeHealth();

  const detectedAtByOpportunity = new Map<string, number>();
  const intentAtByOpportunity = new Map<string, number>();

  let opportunitiesDetected = 0;
  let executionResultsTotal = 0;
  let riskApprovedTotal = 0;
  let riskRejectedTotal = 0;
  let marketEventsWs = 0;
  let marketEventsFallback = 0;
  let marketEventsRest = 0;
  const executionStatusTotals: Record<string, number> = {
    acked: 0,
    filled: 0,
    partially_filled: 0,
    rejected: 0,
    canceled: 0,
    timeout: 0
  };

  function recordEvent(event: InternalEvent) {
    if (event.kind === "market.book_top") {
      if (event.source === "ws") {
        marketEventsWs += 1;
      } else if (event.source === "fallback") {
        marketEventsFallback += 1;
      } else {
        marketEventsRest += 1;
      }
      return;
    }

    if (event.kind === "opportunity.detected") {
      opportunitiesDetected += 1;
      observe(marketToDecision, event.decisionLatencyMs);
      detectedAtByOpportunity.set(event.opportunity.id, event.detectedAtMs);
      return;
    }

    if (event.kind === "risk.decision") {
      if (event.approved) {
        riskApprovedTotal += 1;
      } else {
        riskRejectedTotal += 1;
      }
      return;
    }

    if (event.kind === "execution.intent") {
      const detectedAt = detectedAtByOpportunity.get(event.opportunityId);
      if (detectedAt) {
        observe(decisionToIntent, event.intentAtMs - detectedAt);
      }
      intentAtByOpportunity.set(event.opportunityId, event.intentAtMs);
      return;
    }

    if (event.kind === "execution.result") {
      executionResultsTotal += 1;
      executionStatusTotals[event.status] = (executionStatusTotals[event.status] ?? 0) + 1;

      const intentAt = intentAtByOpportunity.get(event.opportunityId);
      if (intentAt) {
        observe(intentToResult, event.completedAtMs - intentAt);
      }

      intentAtByOpportunity.delete(event.opportunityId);
      detectedAtByOpportunity.delete(event.opportunityId);
      return;
    }
  }

  function recordExchangeStatus(exchange: ExchangeName, message: string) {
    const state = exchangeHealth[exchange];
    state.lastMessage = message;
    state.lastUpdateAt = Date.now();

    const lowered = message.toLowerCase();
    if (lowered.includes("connected")) {
      state.connected = true;
    }
    if (lowered.includes("closed")) {
      state.connected = false;
    }
    if (lowered.includes("reconnect")) {
      state.reconnects += 1;
    }
    if (lowered.includes("error")) {
      state.errors += 1;
    }
    if (lowered.includes("stale")) {
      state.stale += 1;
    }
  }

  function markExchangeHeartbeat(exchange: ExchangeName) {
    const state = exchangeHealth[exchange];
    state.lastUpdateAt = Date.now();
  }

  function getSnapshot(): TelemetrySnapshot {
    return {
      counters: {
        opportunitiesDetected,
        executionResultsTotal,
        riskApprovedTotal,
        riskRejectedTotal,
        marketEventsWs,
        marketEventsFallback,
        marketEventsRest,
        executionStatusTotals: { ...executionStatusTotals }
      },
      latencyMs: {
        marketToDecision: summarize(marketToDecision),
        decisionToIntent: summarize(decisionToIntent),
        intentToResult: summarize(intentToResult)
      },
      exchangeHealth: EXCHANGES.reduce((acc, exchange) => {
        acc[exchange] = { ...exchangeHealth[exchange] };
        return acc;
      }, {} as Record<ExchangeName, ExchangeHealth>)
    };
  }

  function renderPrometheus() {
    const snapshot = getSnapshot();
    const lines: string[] = [];

    lines.push("# HELP btc_bot_opportunities_detected_total Total detected opportunities");
    lines.push("# TYPE btc_bot_opportunities_detected_total counter");
    lines.push(`btc_bot_opportunities_detected_total ${snapshot.counters.opportunitiesDetected}`);

    lines.push("# HELP btc_bot_execution_results_total Total execution results");
    lines.push("# TYPE btc_bot_execution_results_total counter");
    lines.push(`btc_bot_execution_results_total ${snapshot.counters.executionResultsTotal}`);

    lines.push("# HELP btc_bot_risk_decisions_total Risk decisions by approval");
    lines.push("# TYPE btc_bot_risk_decisions_total counter");
    lines.push(`btc_bot_risk_decisions_total{approved=\"true\"} ${snapshot.counters.riskApprovedTotal}`);
    lines.push(`btc_bot_risk_decisions_total{approved=\"false\"} ${snapshot.counters.riskRejectedTotal}`);

    lines.push("# HELP btc_bot_market_events_total Market events by source");
    lines.push("# TYPE btc_bot_market_events_total counter");
    lines.push(`btc_bot_market_events_total{source=\"ws\"} ${snapshot.counters.marketEventsWs}`);
    lines.push(`btc_bot_market_events_total{source=\"fallback\"} ${snapshot.counters.marketEventsFallback}`);
    lines.push(`btc_bot_market_events_total{source=\"rest\"} ${snapshot.counters.marketEventsRest}`);

    lines.push("# HELP btc_bot_execution_status_total Execution result statuses");
    lines.push("# TYPE btc_bot_execution_status_total counter");
    for (const [status, count] of Object.entries(snapshot.counters.executionStatusTotals)) {
      lines.push(`btc_bot_execution_status_total{status=\"${status}\"} ${count}`);
    }

    renderLatency(lines, "market_to_decision", snapshot.latencyMs.marketToDecision);
    renderLatency(lines, "decision_to_intent", snapshot.latencyMs.decisionToIntent);
    renderLatency(lines, "intent_to_result", snapshot.latencyMs.intentToResult);

    lines.push("# HELP btc_bot_exchange_connected Exchange connection status (1 connected, 0 disconnected)");
    lines.push("# TYPE btc_bot_exchange_connected gauge");
    lines.push("# HELP btc_bot_exchange_reconnects_total Exchange reconnect events");
    lines.push("# TYPE btc_bot_exchange_reconnects_total counter");
    lines.push("# HELP btc_bot_exchange_errors_total Exchange error events");
    lines.push("# TYPE btc_bot_exchange_errors_total counter");
    lines.push("# HELP btc_bot_exchange_stale_total Exchange stale events");
    lines.push("# TYPE btc_bot_exchange_stale_total counter");
    lines.push("# HELP btc_bot_exchange_last_update_seconds Exchange last update epoch seconds");
    lines.push("# TYPE btc_bot_exchange_last_update_seconds gauge");

    for (const exchange of EXCHANGES) {
      const health = snapshot.exchangeHealth[exchange];
      const tag = `{exchange=\"${exchange}\"}`;
      lines.push(`btc_bot_exchange_connected${tag} ${health.connected ? 1 : 0}`);
      lines.push(`btc_bot_exchange_reconnects_total${tag} ${health.reconnects}`);
      lines.push(`btc_bot_exchange_errors_total${tag} ${health.errors}`);
      lines.push(`btc_bot_exchange_stale_total${tag} ${health.stale}`);
      lines.push(`btc_bot_exchange_last_update_seconds${tag} ${health.lastUpdateAt ? (health.lastUpdateAt / 1000).toFixed(3) : 0}`);
    }

    return `${lines.join("\n")}\n`;
  }

  return {
    recordEvent,
    recordExchangeStatus,
    markExchangeHeartbeat,
    getSnapshot,
    renderPrometheus
  };
}

function renderLatency(lines: string[], name: string, values: Percentiles) {
  lines.push(`# HELP btc_bot_latency_${name}_ms Latency distribution summary`);
  lines.push(`# TYPE btc_bot_latency_${name}_ms summary`);
  lines.push(`btc_bot_latency_${name}_ms{quantile=\"0.5\"} ${values.p50}`);
  lines.push(`btc_bot_latency_${name}_ms{quantile=\"0.95\"} ${values.p95}`);
  lines.push(`btc_bot_latency_${name}_ms{quantile=\"0.99\"} ${values.p99}`);
  lines.push(`btc_bot_latency_${name}_ms_count ${values.count}`);
}
