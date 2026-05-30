import {
  ENABLE_LIVE_TRADING,
  ENABLE_SANDBOX_TRADING,
  EXECUTION_MODE
} from "../config.js";
import type { EventBus } from "../core/eventBus.js";
import type { Opportunity, WalletBalance } from "../types.js";
import { applySimulatedTrade, canSimulateWithBalances } from "../simulator/simulator.js";
import type { RiskManager } from "../risk/riskManager.js";

type ExchangeGate = (exchange: Opportunity["buyExchange"]) => boolean;
type OpportunityGate = (opportunity: Opportunity) => string | null;

type ExecutionStatus = "acked" | "filled" | "partially_filled" | "rejected" | "canceled" | "timeout";

type ExecutionResult = {
  success: boolean;
  status: ExecutionStatus;
  message: string;
  exchangeOrderId?: string;
};

export function createExecutionEngine(eventBus: EventBus) {
  const executionTimeoutMs = 1_200;

  function executionAllowedByMode() {
    if (EXECUTION_MODE === "paper") {
      return true;
    }

    if (EXECUTION_MODE === "sandbox") {
      return ENABLE_SANDBOX_TRADING;
    }

    return ENABLE_LIVE_TRADING;
  }

  function executeEngineFactory(
    riskManager: RiskManager,
    getBalances: () => WalletBalance[],
    isExchangeAllowed: ExchangeGate = () => true,
    isOpportunityAllowed: OpportunityGate = () => null
  ) {
    async function executeOpportunity(opportunity: Opportunity): Promise<Opportunity> {
      if (opportunity.status !== "detected") {
        return opportunity;
      }

      const executionAllowed = executionAllowedByMode();
      const riskDecision = riskManager.preTradeCheck({
        opportunity,
        balances: getBalances(),
        executionAllowed
      });
      eventBus.emit({
        kind: "risk.decision",
        opportunityId: opportunity.id,
        approved: riskDecision.approved,
        reason: riskDecision.reason,
        decidedAtMs: Date.now()
      });

      if (!riskDecision.approved) {
        return { ...opportunity, status: "ignored", reason: riskDecision.reason };
      }

      if (!canSimulateWithBalances(opportunity)) {
        return { ...opportunity, status: "ignored", reason: "Saldos insuficientes para ejecutar" };
      }

      if (!isExchangeAllowed(opportunity.buyExchange) || !isExchangeAllowed(opportunity.sellExchange)) {
        return { ...opportunity, status: "ignored", reason: "Exchange degradado por el guardia de ejecucion" };
      }

      const rolloutReason = isOpportunityAllowed(opportunity);
      if (rolloutReason) {
        return { ...opportunity, status: "ignored", reason: rolloutReason };
      }

      eventBus.emit({
        kind: "execution.intent",
        opportunityId: opportunity.id,
        buyExchange: opportunity.buyExchange,
        sellExchange: opportunity.sellExchange,
        pair: opportunity.symbol,
        volume: opportunity.volume,
        intentAtMs: Date.now(),
        mode: EXECUTION_MODE
      });

      const result = await runIocLifecycle(opportunity);
      eventBus.emit({
        kind: "execution.result",
        opportunityId: opportunity.id,
        success: result.success,
        status: result.status,
        message: result.message,
        exchangeOrderId: result.exchangeOrderId,
        completedAtMs: Date.now()
      });

      if (!result.success) {
        riskManager.onExecutionResult({
          success: false,
          netProfit: 0,
          balances: getBalances()
        });
        return { ...opportunity, status: "ignored", reason: result.message };
      }

      const executed = applySimulatedTrade(opportunity);
      riskManager.onExecutionResult({
        success: executed.status === "executed",
        netProfit: executed.netProfit,
        balances: getBalances()
      });
      return executed;
    }

    return {
      executeOpportunity
    };
  }

  async function runIocLifecycle(opportunity: Opportunity): Promise<ExecutionResult> {
    const start = Date.now();
    const simulatedAckDelay = 25 + Math.floor(Math.random() * 45);
    await new Promise((resolve) => setTimeout(resolve, simulatedAckDelay));

    if (Date.now() - start > executionTimeoutMs) {
      return { success: false, status: "timeout", message: "Tiempo de espera agotado para el acuse de orden" };
    }

    if (opportunity.netProfit <= 0) {
      return { success: false, status: "rejected", message: "La oportunidad ya no es rentable al ejecutar" };
    }

    const fillChance = Math.max(0.2, Math.min(0.98, 0.58 + opportunity.score / 220 + opportunity.edgeScore / 180));
    if (Math.random() > fillChance) {
      return { success: false, status: "canceled", message: "IOC no llenada, cancelada por el mercado" };
    }

    return {
      success: true,
      status: "filled",
      message: "IOC llenada",
      exchangeOrderId: `sim-${opportunity.buyExchange.toLowerCase()}-${crypto.randomUUID().slice(0, 8)}`
    };
  }

  return {
    withRiskManager: executeEngineFactory
  };
}
