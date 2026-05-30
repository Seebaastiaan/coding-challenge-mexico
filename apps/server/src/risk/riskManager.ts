import {
  MAX_INVENTORY_SKEW_RATIO,
  MAX_LIVE_NOTIONAL_USDT,
  MAX_RISK_CONSECUTIVE_LOSSES,
  MAX_RISK_DRAWDOWN_USDT,
  MAX_TRADES_PER_MINUTE
} from "../config.js";
import type { Opportunity, WalletBalance } from "../types.js";

export type RiskDecision = {
  approved: boolean;
  reason: string;
};

export type RiskState = {
  killSwitchActive: boolean;
  killSwitchReason: string | null;
  lossStreak: number;
  peakPnl: number;
  currentPnl: number;
  currentDrawdown: number;
  tradesInLastMinute: number;
  maxTradesPerMinute: number;
  maxNotionalUsdt: number;
  maxLossStreak: number;
  maxDrawdownUsdt: number;
  maxInventorySkewRatio: number;
  inventorySkewRatio: number;
  lastUpdatedAt: string;
};

export type RiskSnapshot = {
  killSwitchActive: boolean;
  killSwitchReason: string | null;
  lossStreak: number;
  peakPnl: number;
  currentPnl: number;
  currentDrawdown: number;
  tradesInLastMinuteTimestamps: number[];
  recentOrderIds: Array<{ opportunityId: string; timestamp: number }>;
  inventorySkewRatio: number;
  lastUpdatedAt: string;
};

export function createRiskManager() {
  const dedupeWindowMs = 90_000;
  const recentOrderIds = new Map<string, number>();
  const tradeTimestamps: number[] = [];

  let killSwitchActive = false;
  let killSwitchReason: string | null = null;
  let lossStreak = 0;
  let peakPnl = 0;
  let currentPnl = 0;
  let currentDrawdown = 0;
  let inventorySkewRatio = 0;
  let lastUpdatedAt = new Date().toISOString();

  function cleanup(now: number) {
    for (const [opportunityId, ts] of recentOrderIds.entries()) {
      if (now - ts > dedupeWindowMs) {
        recentOrderIds.delete(opportunityId);
      }
    }

    while (tradeTimestamps.length && now - tradeTimestamps[0] > 60_000) {
      tradeTimestamps.shift();
    }
  }

  function evaluateInventorySkew(balances: WalletBalance[]) {
    const totalBtc = balances.reduce((sum, balance) => sum + balance.BTC, 0);
    if (totalBtc <= 0) {
      return 0;
    }

    let maxShare = 0;
    for (const balance of balances) {
      const share = balance.BTC / totalBtc;
      if (share > maxShare) {
        maxShare = share;
      }
    }

    return Number((maxShare - 1 / balances.length).toFixed(4));
  }

  function killSwitch(reason: string) {
    killSwitchActive = true;
    killSwitchReason = reason;
    lastUpdatedAt = new Date().toISOString();
  }

  function clearKillSwitch() {
    killSwitchActive = false;
    killSwitchReason = null;
    lastUpdatedAt = new Date().toISOString();
  }

  function preTradeCheck(input: {
    opportunity: Opportunity;
    balances: WalletBalance[];
    executionAllowed: boolean;
  }): RiskDecision {
    const now = Date.now();
    cleanup(now);

    if (killSwitchActive) {
      return { approved: false, reason: killSwitchReason ?? "Kill switch active" };
    }

    if (recentOrderIds.has(input.opportunity.id)) {
      return { approved: false, reason: "Duplicate execution intent in dedupe window" };
    }

    if (!input.executionAllowed) {
      return { approved: false, reason: "Execution mode is not enabled" };
    }

    const notional = input.opportunity.buyPrice * input.opportunity.volume;
    if (notional > MAX_LIVE_NOTIONAL_USDT) {
      return { approved: false, reason: `Notional ${notional.toFixed(2)} exceeds max ${MAX_LIVE_NOTIONAL_USDT}` };
    }

    if (tradeTimestamps.length >= MAX_TRADES_PER_MINUTE) {
      return { approved: false, reason: `Trades-per-minute limit reached (${MAX_TRADES_PER_MINUTE})` };
    }

    inventorySkewRatio = evaluateInventorySkew(input.balances);
    if (inventorySkewRatio > MAX_INVENTORY_SKEW_RATIO) {
      killSwitch(`Inventory skew ratio ${inventorySkewRatio} exceeded ${MAX_INVENTORY_SKEW_RATIO}`);
      return { approved: false, reason: killSwitchReason ?? "Inventory skew limit breached" };
    }

    recentOrderIds.set(input.opportunity.id, now);
    lastUpdatedAt = new Date().toISOString();
    return { approved: true, reason: "Risk checks passed" };
  }

  function onExecutionResult(input: {
    success: boolean;
    netProfit: number;
    balances: WalletBalance[];
  }) {
    const now = Date.now();
    cleanup(now);

    if (!input.success) {
      lastUpdatedAt = new Date().toISOString();
      return;
    }

    tradeTimestamps.push(now);
    currentPnl += input.netProfit;
    peakPnl = Math.max(peakPnl, currentPnl);
    currentDrawdown = peakPnl - currentPnl;
    lossStreak = input.netProfit < 0 ? lossStreak + 1 : 0;
    inventorySkewRatio = evaluateInventorySkew(input.balances);

    if (lossStreak >= MAX_RISK_CONSECUTIVE_LOSSES) {
      killSwitch(`Loss streak ${lossStreak} reached limit ${MAX_RISK_CONSECUTIVE_LOSSES}`);
    }

    if (currentDrawdown >= MAX_RISK_DRAWDOWN_USDT) {
      killSwitch(`Drawdown ${currentDrawdown.toFixed(2)} reached limit ${MAX_RISK_DRAWDOWN_USDT}`);
    }

    if (inventorySkewRatio > MAX_INVENTORY_SKEW_RATIO) {
      killSwitch(`Inventory skew ratio ${inventorySkewRatio} exceeded ${MAX_INVENTORY_SKEW_RATIO}`);
    }

    lastUpdatedAt = new Date().toISOString();
  }

  function getState(): RiskState {
    cleanup(Date.now());

    return {
      killSwitchActive,
      killSwitchReason,
      lossStreak,
      peakPnl,
      currentPnl,
      currentDrawdown,
      tradesInLastMinute: tradeTimestamps.length,
      maxTradesPerMinute: MAX_TRADES_PER_MINUTE,
      maxNotionalUsdt: MAX_LIVE_NOTIONAL_USDT,
      maxLossStreak: MAX_RISK_CONSECUTIVE_LOSSES,
      maxDrawdownUsdt: MAX_RISK_DRAWDOWN_USDT,
      maxInventorySkewRatio: MAX_INVENTORY_SKEW_RATIO,
      inventorySkewRatio,
      lastUpdatedAt
    };
  }

  function exportState(): RiskSnapshot {
    cleanup(Date.now());
    return {
      killSwitchActive,
      killSwitchReason,
      lossStreak,
      peakPnl,
      currentPnl,
      currentDrawdown,
      tradesInLastMinuteTimestamps: [...tradeTimestamps],
      recentOrderIds: Array.from(recentOrderIds.entries()).map(([opportunityId, timestamp]) => ({
        opportunityId,
        timestamp
      })),
      inventorySkewRatio,
      lastUpdatedAt
    };
  }

  function restoreState(snapshot: RiskSnapshot) {
    killSwitchActive = snapshot.killSwitchActive;
    killSwitchReason = snapshot.killSwitchReason;
    lossStreak = snapshot.lossStreak;
    peakPnl = snapshot.peakPnl;
    currentPnl = snapshot.currentPnl;
    currentDrawdown = snapshot.currentDrawdown;
    inventorySkewRatio = snapshot.inventorySkewRatio;
    lastUpdatedAt = snapshot.lastUpdatedAt;

    tradeTimestamps.splice(0, tradeTimestamps.length, ...snapshot.tradesInLastMinuteTimestamps);
    recentOrderIds.clear();
    for (const entry of snapshot.recentOrderIds) {
      recentOrderIds.set(entry.opportunityId, entry.timestamp);
    }
  }

  return {
    preTradeCheck,
    onExecutionResult,
    getState,
    exportState,
    restoreState,
    killSwitch,
    clearKillSwitch
  };
}

export type RiskManager = ReturnType<typeof createRiskManager>;
