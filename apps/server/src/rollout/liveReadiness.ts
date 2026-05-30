import { EXECUTION_MODE, MAX_LIVE_NOTIONAL_USDT } from "../config.js";
import type { ExchangeName, Opportunity, TradingPair } from "../types.js";
import type { RuntimeGuardState } from "../guard/runtimeGuard.js";
import type { RiskState } from "../risk/riskManager.js";
import type { TelemetrySnapshot } from "../telemetry/telemetry.js";

type RolloutStage = "paper" | "sandbox" | "live-exchange-1" | "live-exchange-3" | "live-all";

type RolloutPolicy = {
  stage: RolloutStage;
  exchanges: ExchangeName[];
  allowedPairs: TradingPair[];
  maxNotionalUsdt: number;
  minOpportunityScore: number;
};

type PreflightCheck = {
  name: string;
  ok: boolean;
  detail: string;
};

type PreflightReport = {
  generatedAt: string;
  mode: string;
  stage: RolloutStage;
  pass: boolean;
  checks: PreflightCheck[];
};

const ALL_EXCHANGES: ExchangeName[] = ["Binance", "Kraken", "OKX", "Bybit", "Coinbase"];
const ALL_PAIRS: TradingPair[] = ["BTC/USDT", "BTC/USD", "BTC/USDC"];

const STAGE_POLICIES: Record<RolloutStage, RolloutPolicy> = {
  paper: {
    stage: "paper",
    exchanges: ALL_EXCHANGES,
    allowedPairs: ALL_PAIRS,
    maxNotionalUsdt: MAX_LIVE_NOTIONAL_USDT,
    minOpportunityScore: 0
  },
  sandbox: {
    stage: "sandbox",
    exchanges: ALL_EXCHANGES,
    allowedPairs: ALL_PAIRS,
    maxNotionalUsdt: MAX_LIVE_NOTIONAL_USDT,
    minOpportunityScore: 65
  },
  "live-exchange-1": {
    stage: "live-exchange-1",
    exchanges: ["Binance"],
    allowedPairs: ["BTC/USDT"],
    maxNotionalUsdt: Math.min(250, MAX_LIVE_NOTIONAL_USDT),
    minOpportunityScore: 75
  },
  "live-exchange-3": {
    stage: "live-exchange-3",
    exchanges: ["Binance", "Kraken", "OKX"],
    allowedPairs: ["BTC/USDT", "BTC/USD"],
    maxNotionalUsdt: Math.min(700, MAX_LIVE_NOTIONAL_USDT),
    minOpportunityScore: 72
  },
  "live-all": {
    stage: "live-all",
    exchanges: ALL_EXCHANGES,
    allowedPairs: ALL_PAIRS,
    maxNotionalUsdt: MAX_LIVE_NOTIONAL_USDT,
    minOpportunityScore: 70
  }
};

export function createLiveReadinessController() {
  let stage: RolloutStage = EXECUTION_MODE === "live" ? "live-exchange-1" : EXECUTION_MODE === "sandbox" ? "sandbox" : "paper";

  function getPolicy() {
    return STAGE_POLICIES[stage];
  }

  function setStage(nextStage: RolloutStage) {
    stage = nextStage;
    return getPolicy();
  }

  function listStages(): RolloutStage[] {
    return ["paper", "sandbox", "live-exchange-1", "live-exchange-3", "live-all"];
  }

  function evaluateOpportunity(opportunity: Opportunity): string | null {
    const policy = getPolicy();

    if (!policy.exchanges.includes(opportunity.buyExchange) || !policy.exchanges.includes(opportunity.sellExchange)) {
      return `Rollout stage ${policy.stage} does not allow exchange route ${opportunity.buyExchange}->${opportunity.sellExchange}`;
    }

    if (!policy.allowedPairs.includes(opportunity.symbol)) {
      return `Rollout stage ${policy.stage} does not allow pair ${opportunity.symbol}`;
    }

    const notional = opportunity.buyPrice * opportunity.volume;
    if (notional > policy.maxNotionalUsdt) {
      return `Rollout stage max notional ${policy.maxNotionalUsdt} exceeded by ${notional.toFixed(2)}`;
    }

    if (opportunity.score < policy.minOpportunityScore) {
      return `Rollout stage min score ${policy.minOpportunityScore} not met (${opportunity.score})`;
    }

    return null;
  }

  function preflight(input: {
    telemetry: TelemetrySnapshot;
    risk: RiskState;
    runtimeGuard: RuntimeGuardState;
    eventCounters: Record<string, number>;
  }): PreflightReport {
    const policy = getPolicy();
    const checks: PreflightCheck[] = [];

    checks.push({
      name: "Market feed activity",
      ok: input.telemetry.counters.marketEventsWs > 20,
      detail: `ws events=${input.telemetry.counters.marketEventsWs}`
    });

    checks.push({
      name: "Opportunity throughput",
      ok: input.telemetry.counters.opportunitiesDetected > 10,
      detail: `opportunities=${input.telemetry.counters.opportunitiesDetected}`
    });

    checks.push({
      name: "Risk kill switch",
      ok: !input.risk.killSwitchActive,
      detail: input.risk.killSwitchActive ? `active: ${input.risk.killSwitchReason ?? "unknown"}` : "inactive"
    });

    checks.push({
      name: "Runtime degraded exchanges",
      ok: input.runtimeGuard.degradedExchanges.length === 0,
      detail: input.runtimeGuard.degradedExchanges.length
        ? `degraded=${input.runtimeGuard.degradedExchanges.join(",")}`
        : "none"
    });

    checks.push({
      name: "Latency p95 market->decision",
      ok: input.telemetry.latencyMs.marketToDecision.p95 <= input.runtimeGuard.sloThresholds.marketToDecisionP95Ms,
      detail: `${input.telemetry.latencyMs.marketToDecision.p95}ms <= ${input.runtimeGuard.sloThresholds.marketToDecisionP95Ms}ms`
    });

    checks.push({
      name: "Latency p95 intent->result",
      ok: input.telemetry.latencyMs.intentToResult.p95 <= input.runtimeGuard.sloThresholds.intentToResultP95Ms,
      detail: `${input.telemetry.latencyMs.intentToResult.p95}ms <= ${input.runtimeGuard.sloThresholds.intentToResultP95Ms}ms`
    });

    checks.push({
      name: "Execution result volume",
      ok: input.telemetry.counters.executionResultsTotal >= 5,
      detail: `executionResults=${input.telemetry.counters.executionResultsTotal}`
    });

    checks.push({
      name: "Rollout policy",
      ok: policy.exchanges.length > 0 && policy.allowedPairs.length > 0,
      detail: `stage=${policy.stage} exchanges=${policy.exchanges.length} pairs=${policy.allowedPairs.length}`
    });

    checks.push({
      name: "Event bus health",
      ok: (input.eventCounters["market.book_top"] ?? 0) > 0,
      detail: `market.book_top=${input.eventCounters["market.book_top"] ?? 0}`
    });

    const pass = checks.every((check) => check.ok);
    return {
      generatedAt: new Date().toISOString(),
      mode: EXECUTION_MODE,
      stage: policy.stage,
      pass,
      checks
    };
  }

  return {
    getPolicy,
    getStage: () => stage,
    setStage,
    listStages,
    evaluateOpportunity,
    preflight
  };
}

export type LiveReadinessController = ReturnType<typeof createLiveReadinessController>;
