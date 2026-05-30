import {
  EXCHANGE_STALE_ALERT_MS,
  SLO_BREACH_CONSECUTIVE_LIMIT,
  SLO_P95_DECISION_TO_INTENT_MS,
  SLO_P95_INTENT_TO_RESULT_MS,
  SLO_P95_MARKET_TO_DECISION_MS
} from "../config.js";
import type { ExchangeName } from "../types.js";
import type { TelemetrySnapshot } from "../telemetry/telemetry.js";

type RuntimeAlert = {
  id: string;
  level: "warn" | "critical";
  scope: "slo" | "exchange" | "manual";
  message: string;
  createdAt: string;
};

export type RuntimeGuardAlert = RuntimeAlert;

type BreachCounters = {
  marketToDecision: number;
  decisionToIntent: number;
  intentToResult: number;
};

const EXCHANGES: ExchangeName[] = ["Binance", "Kraken", "OKX", "Bybit", "Coinbase"];

export function createRuntimeGuard() {
  const degradedExchanges = new Set<ExchangeName>();
  const breachCounters: BreachCounters = {
    marketToDecision: 0,
    decisionToIntent: 0,
    intentToResult: 0
  };
  const alerts: RuntimeAlert[] = [];

  function pushAlert(level: RuntimeAlert["level"], scope: RuntimeAlert["scope"], message: string) {
    const alert: RuntimeAlert = {
      id: crypto.randomUUID(),
      level,
      scope,
      message,
      createdAt: new Date().toISOString()
    };
    alerts.unshift(alert);
    alerts.splice(50);
  }

  function updateFromTelemetry(snapshot: TelemetrySnapshot) {
    const latency = snapshot.latencyMs;

    breachCounters.marketToDecision =
      latency.marketToDecision.count > 20 && latency.marketToDecision.p95 > SLO_P95_MARKET_TO_DECISION_MS
        ? breachCounters.marketToDecision + 1
        : 0;

    breachCounters.decisionToIntent =
      latency.decisionToIntent.count > 20 && latency.decisionToIntent.p95 > SLO_P95_DECISION_TO_INTENT_MS
        ? breachCounters.decisionToIntent + 1
        : 0;

    breachCounters.intentToResult =
      latency.intentToResult.count > 20 && latency.intentToResult.p95 > SLO_P95_INTENT_TO_RESULT_MS
        ? breachCounters.intentToResult + 1
        : 0;

    if (breachCounters.marketToDecision >= SLO_BREACH_CONSECUTIVE_LIMIT) {
      pushAlert(
        "critical",
        "slo",
        `SLO breach market->decision p95=${latency.marketToDecision.p95}ms over ${SLO_P95_MARKET_TO_DECISION_MS}ms`
      );
      breachCounters.marketToDecision = 0;
    }

    if (breachCounters.decisionToIntent >= SLO_BREACH_CONSECUTIVE_LIMIT) {
      pushAlert(
        "warn",
        "slo",
        `SLO breach decision->intent p95=${latency.decisionToIntent.p95}ms over ${SLO_P95_DECISION_TO_INTENT_MS}ms`
      );
      breachCounters.decisionToIntent = 0;
    }

    if (breachCounters.intentToResult >= SLO_BREACH_CONSECUTIVE_LIMIT) {
      pushAlert(
        "critical",
        "slo",
        `SLO breach intent->result p95=${latency.intentToResult.p95}ms over ${SLO_P95_INTENT_TO_RESULT_MS}ms`
      );
      breachCounters.intentToResult = 0;
    }

    const now = Date.now();
    for (const exchange of EXCHANGES) {
      const health = snapshot.exchangeHealth[exchange];
      if (!health) {
        continue;
      }

      const stale = health.lastUpdateAt > 0 && now - health.lastUpdateAt > EXCHANGE_STALE_ALERT_MS;
      const shouldDegrade = !health.connected || stale;

      if (shouldDegrade && !degradedExchanges.has(exchange)) {
        degradedExchanges.add(exchange);
        pushAlert("warn", "exchange", `Exchange ${exchange} degraded (${health.connected ? "stale" : "disconnected"})`);
      }

      if (!shouldDegrade && degradedExchanges.has(exchange)) {
        degradedExchanges.delete(exchange);
        pushAlert("warn", "exchange", `Exchange ${exchange} recovered`);
      }
    }
  }

  function isExchangeAllowed(exchange: ExchangeName) {
    return !degradedExchanges.has(exchange);
  }

  function addManualAlert(message: string) {
    pushAlert("warn", "manual", message);
  }

  function clearAlerts() {
    alerts.splice(0, alerts.length);
  }

  function getState() {
    return {
      degradedExchanges: Array.from(degradedExchanges),
      sloThresholds: {
        marketToDecisionP95Ms: SLO_P95_MARKET_TO_DECISION_MS,
        decisionToIntentP95Ms: SLO_P95_DECISION_TO_INTENT_MS,
        intentToResultP95Ms: SLO_P95_INTENT_TO_RESULT_MS,
        consecutiveLimit: SLO_BREACH_CONSECUTIVE_LIMIT
      },
      breachCounters: { ...breachCounters },
      exchangeStaleAlertMs: EXCHANGE_STALE_ALERT_MS,
      alerts: [...alerts]
    };
  }

  return {
    updateFromTelemetry,
    isExchangeAllowed,
    addManualAlert,
    clearAlerts,
    getState
  };
}

export type RuntimeGuardState = ReturnType<ReturnType<typeof createRuntimeGuard>["getState"]>;
