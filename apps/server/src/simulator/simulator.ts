import { INITIAL_BALANCES, MIN_SCORE } from "../config.js";
import type { ExchangeName, Opportunity, PerformanceMetrics, Trade, WalletBalance } from "../types.js";

export type SimulatorState = {
  balances: WalletBalance[];
  trades: Trade[];
  pnlSeries: Array<{ time: string; pnl: number }>;
  exchangeOpportunityCounts: Record<ExchangeName, number>;
  cumulativePnl: number;
  consecutiveLosses: number;
  pausedUntil: number;
};

const balances = new Map<ExchangeName, WalletBalance>(
  Object.entries(INITIAL_BALANCES).map(([exchange, balance]) => [
    exchange as ExchangeName,
    { exchange: exchange as ExchangeName, ...balance }
  ])
);

const trades: Trade[] = [];
const pnlSeries: Array<{ time: string; pnl: number }> = [];
const exchangeOpportunityCounts: Record<ExchangeName, number> = {
  Binance: 0,
  Kraken: 0,
  OKX: 0,
  Bybit: 0,
  Coinbase: 0
};

let cumulativePnl = 0;
let consecutiveLosses = 0;
let pausedUntil = 0;

function hasSufficientBalance(opportunity: Opportunity) {
  const buyWallet = balances.get(opportunity.buyExchange);
  const sellWallet = balances.get(opportunity.sellExchange);

  if (!buyWallet || !sellWallet) {
    return false;
  }

  const buyCost = opportunity.buyPrice * opportunity.volume + opportunity.fees / 2;

  return buyWallet.USDT >= buyCost && sellWallet.BTC >= opportunity.volume;
}

export function canSimulateWithBalances(opportunity: Opportunity) {
  return hasSufficientBalance(opportunity);
}

function circuitBreakerActive() {
  return pausedUntil > Date.now();
}

export function recordOpportunity(opportunity: Opportunity) {
  exchangeOpportunityCounts[opportunity.buyExchange] += 1;
  exchangeOpportunityCounts[opportunity.sellExchange] += 1;
}

export function simulateIfEligible(opportunity: Opportunity): Opportunity {
  if (circuitBreakerActive()) {
    return { ...opportunity, status: "ignored", reason: "Circuit breaker is cooling down" };
  }

  if (opportunity.status !== "detected" || opportunity.score < MIN_SCORE) {
    return opportunity;
  }

  if (!hasSufficientBalance(opportunity)) {
    return { ...opportunity, status: "ignored", reason: "Insufficient simulated balance" };
  }

  return applySimulatedTrade(opportunity);
}

export function applySimulatedTrade(opportunity: Opportunity): Opportunity {
  if (!hasSufficientBalance(opportunity)) {
    return { ...opportunity, status: "ignored", reason: "Insufficient simulated balance" };
  }

  const buyWallet = balances.get(opportunity.buyExchange)!;
  const sellWallet = balances.get(opportunity.sellExchange)!;
  const buyCost = opportunity.buyPrice * opportunity.volume + opportunity.fees / 2;
  const sellRevenue = opportunity.sellPrice * opportunity.volume - opportunity.fees / 2 - opportunity.slippage;

  buyWallet.USDT -= buyCost;
  buyWallet.BTC += opportunity.volume;
  sellWallet.BTC -= opportunity.volume;
  sellWallet.USDT += sellRevenue;

  const trade: Trade = {
    id: crypto.randomUUID(),
    opportunityId: opportunity.id,
    buyExchange: opportunity.buyExchange,
    sellExchange: opportunity.sellExchange,
    volume: opportunity.volume,
    buyPrice: opportunity.buyPrice,
    sellPrice: opportunity.sellPrice,
    netProfit: opportunity.netProfit,
    executedAt: new Date().toISOString()
  };

  trades.unshift(trade);
  trades.splice(100);

  cumulativePnl += opportunity.netProfit;
  consecutiveLosses = opportunity.netProfit < 0 ? consecutiveLosses + 1 : 0;
  pnlSeries.push({
    time: new Date().toLocaleTimeString("en-US", { hour12: false }),
    pnl: Number(cumulativePnl.toFixed(2))
  });
  pnlSeries.splice(60);

  if (consecutiveLosses >= 3) {
    pausedUntil = Date.now() + 60_000;
  }

  return { ...opportunity, status: "executed", reason: "Simulated trade executed" };
}

export function getBalances() {
  return Array.from(balances.values()).map((balance) => ({ ...balance }));
}

export function getTrades() {
  return [...trades];
}

export function getMetrics(opportunitiesDetected: number): PerformanceMetrics {
  const wins = trades.filter((trade) => trade.netProfit > 0).length;
  const profits = trades.map((trade) => trade.netProfit);

  return {
    cumulativePnl,
    opportunitiesDetected,
    tradesSimulated: trades.length,
    winRate: trades.length ? (wins / trades.length) * 100 : 0,
    averageProfit: trades.length ? cumulativePnl / trades.length : 0,
    bestTrade: profits.length ? Math.max(...profits) : 0,
    worstTrade: profits.length ? Math.min(...profits) : 0,
    consecutiveLosses,
    pausedUntil: circuitBreakerActive() ? new Date(pausedUntil).toISOString() : null,
    pnlSeries: [...pnlSeries],
    exchangeOpportunityCounts: { ...exchangeOpportunityCounts }
  };
}

export function exportSimulatorState(): SimulatorState {
  return {
    balances: getBalances(),
    trades: getTrades(),
    pnlSeries: [...pnlSeries],
    exchangeOpportunityCounts: { ...exchangeOpportunityCounts },
    cumulativePnl,
    consecutiveLosses,
    pausedUntil
  };
}

export function restoreSimulatorState(state: SimulatorState) {
  balances.clear();
  for (const balance of state.balances) {
    balances.set(balance.exchange, { ...balance });
  }

  trades.splice(0, trades.length, ...state.trades.map((trade) => ({ ...trade })));
  pnlSeries.splice(0, pnlSeries.length, ...state.pnlSeries.map((point) => ({ ...point })));

  for (const key of Object.keys(exchangeOpportunityCounts) as ExchangeName[]) {
    exchangeOpportunityCounts[key] = state.exchangeOpportunityCounts[key] ?? 0;
  }

  cumulativePnl = state.cumulativePnl;
  consecutiveLosses = state.consecutiveLosses;
  pausedUntil = state.pausedUntil;
}
