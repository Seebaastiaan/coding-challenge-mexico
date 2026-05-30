export type ExchangeName = "Binance" | "Kraken" | "OKX" | "Bybit" | "Coinbase";
export type OpportunityStatus = "detected" | "executed" | "ignored" | "observed";

export type TradingPair = "BTC/USDT" | "BTC/USD" | "BTC/USDC";

export type MarketSnapshot = {
  exchange: ExchangeName;
  symbol: TradingPair;
  bestBid: number;
  bestAsk: number;
  bidVolume: number;
  askVolume: number;
  timestamp: number;
  source: "live" | "fallback";
};

export type Opportunity = {
  id: string;
  buyExchange: ExchangeName;
  sellExchange: ExchangeName;
  symbol: TradingPair;
  buyPrice: number;
  sellPrice: number;
  volume: number;
  grossProfit: number;
  netProfit: number;
  fees: number;
  slippage: number;
  latencyMs: number;
  score: number;
  edgeScore: number;
  status: OpportunityStatus;
  reason: string;
  createdAt: string;
};

export type Trade = {
  id: string;
  opportunityId: string;
  buyExchange: ExchangeName;
  sellExchange: ExchangeName;
  volume: number;
  buyPrice: number;
  sellPrice: number;
  netProfit: number;
  executedAt: string;
};

export type WalletBalance = {
  exchange: ExchangeName;
  BTC: number;
  USDT: number;
};

export type PerformanceMetrics = {
  cumulativePnl: number;
  opportunitiesDetected: number;
  tradesSimulated: number;
  winRate: number;
  averageProfit: number;
  bestTrade: number;
  worstTrade: number;
  consecutiveLosses: number;
  pausedUntil: string | null;
  pnlSeries: Array<{ time: string; pnl: number }>;
  exchangeOpportunityCounts: Record<ExchangeName, number>;
};

export type RadarState = {
  market: MarketSnapshot[];
  opportunities: Opportunity[];
  trades: Trade[];
  balances: WalletBalance[];
  metrics: PerformanceMetrics;
  updatedAt: string;
};
