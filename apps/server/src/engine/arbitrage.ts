import { MAX_LATENCY_MS, MIN_PROFIT, MIN_SCORE, MIN_VOLUME_BTC, SIMULATION_VOLUME_BTC } from "../config.js";
import { calculateProfit } from "./profit.js";
import { scoreOpportunity } from "./scoring.js";
import type { MarketSnapshot, Opportunity, OpportunityStatus } from "../types.js";

function classify(input: {
  netProfit: number;
  score: number;
  volume: number;
  minAvailableVolume: number;
  latencyMs: number;
  slippage: number;
}): { status: OpportunityStatus; reason: string } {
  if (input.netProfit <= MIN_PROFIT) {
    return { status: "ignored", reason: `Ganancia neta por debajo de ${MIN_PROFIT} USDT` };
  }

  if (input.score < MIN_SCORE) {
    return { status: "observed", reason: `Puntaje por debajo de ${MIN_SCORE}` };
  }

  if (input.minAvailableVolume < Math.max(input.volume, MIN_VOLUME_BTC)) {
    return { status: "ignored", reason: "Liquidez visible insuficiente" };
  }

  if (input.latencyMs > MAX_LATENCY_MS) {
    return { status: "ignored", reason: `Latencia por encima de ${MAX_LATENCY_MS} ms` };
  }

  if (input.slippage >= input.netProfit) {
    return { status: "ignored", reason: "El deslizamiento supera la ganancia" };
  }

  return { status: "detected", reason: "Elegible para simulacion" };
}

function edgeScore(input: {
  netProfit: number;
  slippage: number;
  latencyMs: number;
  minAvailableVolume: number;
  volume: number;
}) {
  const slippagePenalty = input.slippage * 0.7;
  const latencyPenalty = input.latencyMs * 0.003;
  const liquidityRatio = input.minAvailableVolume / Math.max(input.volume, 0.00000001);
  const liquidityBonus = Math.min(liquidityRatio, 5) * 0.6;
  const riskPenalty = input.netProfit <= 0 ? 20 : 0;

  return Number((input.netProfit - slippagePenalty - latencyPenalty + liquidityBonus - riskPenalty).toFixed(4));
}

function compareByEdge(a: Opportunity, b: Opportunity) {
  if (b.edgeScore !== a.edgeScore) {
    return b.edgeScore - a.edgeScore;
  }

  return b.score - a.score;
}

export function rankOpportunities(opportunities: Opportunity[]) {
  return [...opportunities].sort(compareByEdge);
}

export function buildOpportunity(buyMarket: MarketSnapshot, sellMarket: MarketSnapshot): Opportunity | null {
  if (buyMarket.exchange === sellMarket.exchange || buyMarket.bestAsk >= sellMarket.bestBid) {
    return null;
  }

  const minAvailableVolume = Math.min(buyMarket.askVolume, sellMarket.bidVolume);
  const volume = Math.min(SIMULATION_VOLUME_BTC, minAvailableVolume);
  const latencyMs = Math.max(Date.now() - buyMarket.timestamp, Date.now() - sellMarket.timestamp);
  const profit = calculateProfit({
    buyExchange: buyMarket.exchange,
    sellExchange: sellMarket.exchange,
    buyPrice: buyMarket.bestAsk,
    sellPrice: sellMarket.bestBid,
    volume,
    availableAskVolume: buyMarket.askVolume,
    availableBidVolume: sellMarket.bidVolume
  });
  const score = scoreOpportunity({
    ...profit,
    latencyMs,
    volume,
    minAvailableVolume
  });
  const decision = classify({
    netProfit: profit.netProfit,
    score,
    volume,
    minAvailableVolume,
    latencyMs,
    slippage: profit.slippage
  });

  return {
    id: crypto.randomUUID(),
    buyExchange: buyMarket.exchange,
    sellExchange: sellMarket.exchange,
    symbol: buyMarket.symbol,
    buyPrice: buyMarket.bestAsk,
    sellPrice: sellMarket.bestBid,
    volume,
    grossProfit: profit.grossProfit,
    netProfit: profit.netProfit,
    fees: profit.fees,
    slippage: profit.slippage,
    latencyMs,
    score,
    edgeScore: edgeScore({
      netProfit: profit.netProfit,
      slippage: profit.slippage,
      latencyMs,
      minAvailableVolume,
      volume
    }),
    status: decision.status,
    reason: decision.reason,
    createdAt: new Date().toISOString()
  };
}

export function findOpportunities(snapshots: MarketSnapshot[]): Opportunity[] {
  const opportunities: Opportunity[] = [];

  for (const buyMarket of snapshots) {
    for (const sellMarket of snapshots) {
      const opportunity = buildOpportunity(buyMarket, sellMarket);
      if (opportunity) {
        opportunities.push(opportunity);
      }
    }
  }

  return rankOpportunities(opportunities);
}
