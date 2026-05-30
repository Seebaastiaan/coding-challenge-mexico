export type ExchangeName = "Binance" | "Kraken" | "OKX" | "Bybit" | "Coinbase";
export type OpportunityStatus = "detected" | "executed" | "ignored" | "observed";

export type MarketSnapshot = {
  exchange: ExchangeName;
  symbol: "BTC/USDT";
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
  symbol: "BTC/USDT";
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

export type RadarState = {
  market: MarketSnapshot[];
  opportunities: Opportunity[];
  trades: Trade[];
  balances: WalletBalance[];
  metrics: {
    cumulativePnl: number;
    totalProfitGenerated: number;
    opportunitiesDetected: number;
    tradesGenerated: number;
    winRate: number;
    averageProfit: number;
    bestTrade: number;
    worstTrade: number;
    consecutiveLosses: number;
    pausedUntil: string | null;
    pnlSeries: Array<{ time: string; pnl: number }>;
    exchangeOpportunityCounts: Record<ExchangeName, number>;
  };
  updatedAt: string;
};

const SUPPORTED_EXCHANGES: ExchangeName[] = [
  "Binance",
  "Kraken",
  "OKX",
  "Bybit",
  "Coinbase",
];

const INITIAL_BALANCES: Record<ExchangeName, { BTC: number; USDT: number }> = {
  Binance: { BTC: 1, USDT: 50_000 },
  Kraken: { BTC: 1, USDT: 50_000 },
  OKX: { BTC: 1, USDT: 50_000 },
  Bybit: { BTC: 1, USDT: 50_000 },
  Coinbase: { BTC: 1, USDT: 50_000 },
};

const MIN_PROFIT = Number(process.env.MIN_PROFIT ?? 0.01);
const MIN_SCORE = Number(process.env.MIN_SCORE ?? 20);
const MIN_VOLUME_BTC = Number(process.env.MIN_VOLUME_BTC ?? 0.001);
const MAX_LATENCY_MS = Number(process.env.MAX_LATENCY_MS ?? 1_000);
const SIMULATION_VOLUME_BTC = Number(process.env.SIMULATION_VOLUME_BTC ?? 0.05);
const REQUEST_TIMEOUT_MS = Number(process.env.RADAR_FETCH_TIMEOUT_MS ?? 2_500);

function toNumber(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function isUsableSnapshot(snapshot: MarketSnapshot) {
  return (
    snapshot.bestBid > 0 &&
    snapshot.bestAsk > 0 &&
    snapshot.bestBid < snapshot.bestAsk &&
    snapshot.bidVolume > 0 &&
    snapshot.askVolume > 0
  );
}

async function fetchJson(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "User-Agent": "btc-arbitrage-radar",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as unknown;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function binanceSnapshot(): Promise<MarketSnapshot | null> {
  const payload = await fetchJson(
    "https://api.binance.com/api/v3/ticker/bookTicker?symbol=BTCUSDT",
  );
  const item = payload as {
    bidPrice?: unknown;
    bidQty?: unknown;
    askPrice?: unknown;
    askQty?: unknown;
  } | null;
  const bestBid = toNumber(item?.bidPrice);
  const bestAsk = toNumber(item?.askPrice);
  const bidVolume = toNumber(item?.bidQty);
  const askVolume = toNumber(item?.askQty);

  if (!bestBid || !bestAsk || !bidVolume || !askVolume) return null;

  return {
    exchange: "Binance",
    symbol: "BTC/USDT",
    bestBid,
    bestAsk,
    bidVolume,
    askVolume,
    timestamp: Date.now(),
    source: "live",
  };
}

async function krakenSnapshot(): Promise<MarketSnapshot | null> {
  const payload = await fetchJson(
    "https://api.kraken.com/0/public/Ticker?pair=XBTUSDT",
  );
  const result = (payload as { result?: Record<string, unknown> } | null)
    ?.result;
  const ticker = result?.XBTUSDT as
    | { a?: unknown[]; b?: unknown[] }
    | undefined;
  const bestAsk = toNumber(ticker?.a?.[0]);
  const bestBid = toNumber(ticker?.b?.[0]);
  const askVolume = toNumber(ticker?.a?.[1]) ?? 0.15;
  const bidVolume = toNumber(ticker?.b?.[1]) ?? 0.15;

  if (!bestBid || !bestAsk) return null;

  return {
    exchange: "Kraken",
    symbol: "BTC/USDT",
    bestBid,
    bestAsk,
    bidVolume,
    askVolume,
    timestamp: Date.now(),
    source: "live",
  };
}

async function okxSnapshot(): Promise<MarketSnapshot | null> {
  const payload = await fetchJson(
    "https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT",
  );
  const ticker = (payload as { data?: unknown[] } | null)?.data?.[0] as
    | {
        bidPx?: unknown;
        bidSz?: unknown;
        askPx?: unknown;
        askSz?: unknown;
      }
    | undefined;
  const bestBid = toNumber(ticker?.bidPx);
  const bestAsk = toNumber(ticker?.askPx);
  const bidVolume = toNumber(ticker?.bidSz);
  const askVolume = toNumber(ticker?.askSz);

  if (!bestBid || !bestAsk || !bidVolume || !askVolume) return null;

  return {
    exchange: "OKX",
    symbol: "BTC/USDT",
    bestBid,
    bestAsk,
    bidVolume,
    askVolume,
    timestamp: Date.now(),
    source: "live",
  };
}

async function bybitSnapshot(): Promise<MarketSnapshot | null> {
  const payload = await fetchJson(
    "https://api.bybit.com/v5/market/tickers?category=spot&symbol=BTCUSDT",
  );
  const ticker = (
    payload as { result?: { list?: unknown[] } } | null
  )?.result?.list?.[0] as
    | {
        bid1Price?: unknown;
        bid1Size?: unknown;
        ask1Price?: unknown;
        ask1Size?: unknown;
      }
    | undefined;
  const bestBid = toNumber(ticker?.bid1Price);
  const bestAsk = toNumber(ticker?.ask1Price);
  const bidVolume = toNumber(ticker?.bid1Size);
  const askVolume = toNumber(ticker?.ask1Size);

  if (!bestBid || !bestAsk || !bidVolume || !askVolume) return null;

  return {
    exchange: "Bybit",
    symbol: "BTC/USDT",
    bestBid,
    bestAsk,
    bidVolume,
    askVolume,
    timestamp: Date.now(),
    source: "live",
  };
}

async function coinbaseSnapshot(): Promise<MarketSnapshot | null> {
  const payload = await fetchJson(
    "https://api.exchange.coinbase.com/products/BTC-USDT/book?level=1",
  );
  const book = payload as { bids?: unknown[][]; asks?: unknown[][] } | null;
  const bid = book?.bids?.[0];
  const ask = book?.asks?.[0];
  const bestBid = toNumber(bid?.[0]);
  const bidVolume = toNumber(bid?.[1]);
  const bestAsk = toNumber(ask?.[0]);
  const askVolume = toNumber(ask?.[1]);

  if (!bestBid || !bestAsk || !bidVolume || !askVolume) return null;

  return {
    exchange: "Coinbase",
    symbol: "BTC/USDT",
    bestBid,
    bestAsk,
    bidVolume,
    askVolume,
    timestamp: Date.now(),
    source: "live",
  };
}

function fallbackSnapshot(
  exchange: ExchangeName,
  index: number,
  referenceMid: number,
): MarketSnapshot {
  const offsets = [-42, 18, 64, -8, 37];
  const drift = Math.sin(Date.now() / 15_000 + index) * 8;
  const mid = referenceMid + offsets[index] + drift;

  return {
    exchange,
    symbol: "BTC/USDT",
    bestBid: Number((mid - 5).toFixed(2)),
    bestAsk: Number((mid + 5).toFixed(2)),
    bidVolume: Number((0.35 + index * 0.11).toFixed(4)),
    askVolume: Number((0.32 + index * 0.12).toFixed(4)),
    timestamp: Date.now(),
    source: "fallback",
  };
}

async function getMarketSnapshots() {
  const fetchers: Record<ExchangeName, () => Promise<MarketSnapshot | null>> = {
    Binance: binanceSnapshot,
    Kraken: krakenSnapshot,
    OKX: okxSnapshot,
    Bybit: bybitSnapshot,
    Coinbase: coinbaseSnapshot,
  };
  const settled = await Promise.allSettled(
    SUPPORTED_EXCHANGES.map((exchange) => fetchers[exchange]()),
  );
  const liveSnapshots = settled
    .map((result) => (result.status === "fulfilled" ? result.value : null))
    .filter((snapshot): snapshot is MarketSnapshot =>
      Boolean(snapshot && isUsableSnapshot(snapshot)),
    );
  const referenceMid = liveSnapshots.length
    ? liveSnapshots.reduce(
        (total, snapshot) =>
          total + (snapshot.bestBid + snapshot.bestAsk) / 2,
        0,
      ) / liveSnapshots.length
    : 70_000;

  return SUPPORTED_EXCHANGES.map((exchange, index) => {
    return (
      liveSnapshots.find((snapshot) => snapshot.exchange === exchange) ??
      fallbackSnapshot(exchange, index, referenceMid)
    );
  });
}

function scoreOpportunity(input: {
  netProfit: number;
  grossProfit: number;
  slippage: number;
  latencyMs: number;
  volume: number;
  minAvailableVolume: number;
}) {
  const profitScore = Math.min(Math.max(input.netProfit / 25, 0), 1) * 42;
  const spreadScore = Math.min(Math.max(input.grossProfit / 40, 0), 1) * 18;
  const liquidityRatio =
    input.minAvailableVolume / Math.max(input.volume, 0.00000001);
  const liquidityScore = Math.min(liquidityRatio / 12, 1) * 18;
  const latencyScore = Math.max(0, 1 - input.latencyMs / 1_500) * 12;
  const slippagePenalty =
    Math.min(Math.max(input.slippage / Math.max(input.netProfit, 1), 0), 1) *
    16;
  const riskPenalty = input.netProfit < 0 ? 25 : 0;

  return Math.round(
    Math.max(
      0,
      Math.min(
        100,
        profitScore +
          spreadScore +
          liquidityScore +
          latencyScore -
          slippagePenalty -
          riskPenalty,
      ),
    ),
  );
}

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

  return { status: "detected", reason: "Elegible para ejecucion" };
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
  const liquidityRatio =
    input.minAvailableVolume / Math.max(input.volume, 0.00000001);
  const liquidityBonus = Math.min(liquidityRatio, 5) * 0.6;
  const riskPenalty = input.netProfit <= 0 ? 20 : 0;

  return Number(
    (
      input.netProfit -
      slippagePenalty -
      latencyPenalty +
      liquidityBonus -
      riskPenalty
    ).toFixed(4),
  );
}

function buildOpportunity(
  buyMarket: MarketSnapshot,
  sellMarket: MarketSnapshot,
): Opportunity | null {
  if (
    buyMarket.exchange === sellMarket.exchange ||
    buyMarket.bestAsk >= sellMarket.bestBid
  ) {
    return null;
  }

  const minAvailableVolume = Math.min(buyMarket.askVolume, sellMarket.bidVolume);
  const volume = Math.min(SIMULATION_VOLUME_BTC, minAvailableVolume);
  const latencyMs = Math.max(
    Date.now() - buyMarket.timestamp,
    Date.now() - sellMarket.timestamp,
  );
  const grossProfit = (sellMarket.bestBid - buyMarket.bestAsk) * volume;
  const fees = 0;
  const slippage = 0;
  const netProfit = grossProfit - fees - slippage;
  const score = scoreOpportunity({
    netProfit,
    grossProfit,
    slippage,
    latencyMs,
    volume,
    minAvailableVolume,
  });
  const decision = classify({
    netProfit,
    score,
    volume,
    minAvailableVolume,
    latencyMs,
    slippage,
  });

  return {
    id: `${buyMarket.exchange}-${sellMarket.exchange}-${Date.now()}`,
    buyExchange: buyMarket.exchange,
    sellExchange: sellMarket.exchange,
    symbol: "BTC/USDT",
    buyPrice: buyMarket.bestAsk,
    sellPrice: sellMarket.bestBid,
    volume,
    grossProfit,
    netProfit,
    fees,
    slippage,
    latencyMs,
    score,
    edgeScore: edgeScore({
      netProfit,
      slippage,
      latencyMs,
      minAvailableVolume,
      volume,
    }),
    status: decision.status,
    reason: decision.reason,
    createdAt: new Date().toISOString(),
  };
}

function findOpportunities(snapshots: MarketSnapshot[]) {
  const opportunities: Opportunity[] = [];

  for (const buyMarket of snapshots) {
    for (const sellMarket of snapshots) {
      const opportunity = buildOpportunity(buyMarket, sellMarket);
      if (opportunity) {
        opportunities.push(opportunity);
      }
    }
  }

  return opportunities.sort((a, b) => {
    if (b.edgeScore !== a.edgeScore) return b.edgeScore - a.edgeScore;
    return b.score - a.score;
  });
}

function initialBalances() {
  return SUPPORTED_EXCHANGES.map((exchange) => ({
    exchange,
    ...INITIAL_BALANCES[exchange],
  }));
}

function generateTrades(opportunities: Opportunity[], balances: WalletBalance[]) {
  const balanceByExchange = new Map(
    balances.map((balance) => [balance.exchange, balance]),
  );
  const trades: Trade[] = [];
  const processed = opportunities.map((opportunity) => {
    if (opportunity.status !== "detected") return opportunity;

    const buyWallet = balanceByExchange.get(opportunity.buyExchange);
    const sellWallet = balanceByExchange.get(opportunity.sellExchange);
    if (!buyWallet || !sellWallet) return opportunity;

    const buyCost = opportunity.buyPrice * opportunity.volume;
    if (buyWallet.USDT < buyCost || sellWallet.BTC < opportunity.volume) {
        return {
          ...opportunity,
          status: "ignored" as const,
          reason: "Saldo disponible insuficiente",
        };
    }

    buyWallet.USDT -= buyCost;
    buyWallet.BTC += opportunity.volume;
    sellWallet.BTC -= opportunity.volume;
    sellWallet.USDT += opportunity.sellPrice * opportunity.volume;

    trades.push({
      id: `trade-${opportunity.id}`,
      opportunityId: opportunity.id,
      buyExchange: opportunity.buyExchange,
      sellExchange: opportunity.sellExchange,
      volume: opportunity.volume,
      buyPrice: opportunity.buyPrice,
      sellPrice: opportunity.sellPrice,
      netProfit: opportunity.netProfit,
      executedAt: new Date().toISOString(),
    });

    return {
      ...opportunity,
      status: "executed" as const,
      reason: "Operacion ejecutada por el motor de rutas",
    };
  });

  return { opportunities: processed, trades };
}

function buildMetrics(opportunities: Opportunity[], trades: Trade[]) {
  const cumulativePnl = trades.reduce((total, trade) => total + trade.netProfit, 0);
  const wins = trades.filter((trade) => trade.netProfit > 0).length;
  const profits = trades.map((trade) => trade.netProfit);
  const exchangeOpportunityCounts = SUPPORTED_EXCHANGES.reduce(
    (counts, exchange) => {
      counts[exchange] = 0;
      return counts;
    },
    {} as Record<ExchangeName, number>,
  );

  for (const opportunity of opportunities) {
    exchangeOpportunityCounts[opportunity.buyExchange] += 1;
    exchangeOpportunityCounts[opportunity.sellExchange] += 1;
  }

  return {
    cumulativePnl,
    totalProfitGenerated: cumulativePnl,
    opportunitiesDetected: opportunities.length,
    tradesGenerated: trades.length,
    winRate: trades.length ? (wins / trades.length) * 100 : 0,
    averageProfit: trades.length ? cumulativePnl / trades.length : 0,
    bestTrade: profits.length ? Math.max(...profits) : 0,
    worstTrade: profits.length ? Math.min(...profits) : 0,
    consecutiveLosses: 0,
    pausedUntil: null,
    pnlSeries: trades
      .slice(0, 30)
      .reverse()
      .reduce<Array<{ time: string; pnl: number }>>((series, trade) => {
        const previous = series.at(-1)?.pnl ?? 0;
        series.push({
          time: new Date(trade.executedAt).toLocaleTimeString("es-ES", {
            hour12: false,
          }),
          pnl: Number((previous + trade.netProfit).toFixed(2)),
        });
        return series;
      }, []),
    exchangeOpportunityCounts,
  };
}

export async function getServerlessRadarState(): Promise<RadarState> {
  const market = await getMarketSnapshots();
  const balances = initialBalances();
  const rankedOpportunities = findOpportunities(market).slice(0, 100);
  const execution = generateTrades(rankedOpportunities, balances);

  return {
    market,
    opportunities: execution.opportunities,
    trades: execution.trades,
    balances,
    metrics: buildMetrics(execution.opportunities, execution.trades),
    updatedAt: new Date().toISOString(),
  };
}

export function renderPrometheusMetrics(state: RadarState) {
  return [
    "# HELP btc_bot_market_snapshots Current market snapshots returned by the serverless route.",
    "# TYPE btc_bot_market_snapshots gauge",
    `btc_bot_market_snapshots ${state.market.length}`,
    "# HELP btc_bot_opportunities_detected Opportunities detected in the latest serverless evaluation.",
    "# TYPE btc_bot_opportunities_detected gauge",
    `btc_bot_opportunities_detected ${state.metrics.opportunitiesDetected}`,
    "# HELP btc_bot_trades_generated Trades generated in the latest serverless evaluation.",
    "# TYPE btc_bot_trades_generated gauge",
    `btc_bot_trades_generated ${state.metrics.tradesGenerated}`,
    "# HELP btc_bot_total_profit_generated Total profit generated in the latest serverless evaluation.",
    "# TYPE btc_bot_total_profit_generated gauge",
    `btc_bot_total_profit_generated ${state.metrics.totalProfitGenerated}`,
    "",
  ].join("\n");
}
