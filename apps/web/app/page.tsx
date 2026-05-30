"use client";

import {
  Activity,
  ArrowRight,
  BadgeCheck,
  Ban,
  CircleAlert,
  CircleDollarSign,
  Clock3,
  Coins,
  Gauge,
  Landmark,
  PauseCircle,
  Radar,
  RefreshCcw,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  WalletCards,
  Waves
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { io, type Socket } from "socket.io-client";

type ExchangeName = "Binance" | "Kraken" | "OKX" | "Bybit" | "Coinbase";
type OpportunityStatus = "detected" | "executed" | "ignored" | "observed";

type MarketSnapshot = {
  exchange: ExchangeName;
  symbol: "BTC/USDT";
  bestBid: number;
  bestAsk: number;
  bidVolume: number;
  askVolume: number;
  timestamp: number;
  source: "live" | "fallback";
};

type Opportunity = {
  id: string;
  buyExchange: ExchangeName;
  sellExchange: ExchangeName;
  buyPrice: number;
  sellPrice: number;
  volume: number;
  grossProfit: number;
  netProfit: number;
  fees: number;
  slippage: number;
  latencyMs: number;
  score: number;
  status: OpportunityStatus;
  reason: string;
  createdAt: string;
};

type Trade = {
  id: string;
  buyExchange: ExchangeName;
  sellExchange: ExchangeName;
  volume: number;
  buyPrice: number;
  sellPrice: number;
  netProfit: number;
  executedAt: string;
};

type WalletBalance = {
  exchange: ExchangeName;
  BTC: number;
  USDT: number;
};

type RadarState = {
  market: MarketSnapshot[];
  opportunities: Opportunity[];
  trades: Trade[];
  balances: WalletBalance[];
  metrics: {
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
  updatedAt: string;
};

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:4000";
const SUPPORTED_EXCHANGES: ExchangeName[] = ["Binance", "Kraken", "OKX", "Bybit", "Coinbase"];

const emptyState: RadarState = {
  market: [],
  opportunities: [],
  trades: [],
  balances: [],
  metrics: {
    cumulativePnl: 0,
    opportunitiesDetected: 0,
    tradesSimulated: 0,
    winRate: 0,
    averageProfit: 0,
    bestTrade: 0,
    worstTrade: 0,
    consecutiveLosses: 0,
    pausedUntil: null,
    pnlSeries: [],
    exchangeOpportunityCounts: {
      Binance: 0,
      Kraken: 0,
      OKX: 0,
      Bybit: 0,
      Coinbase: 0
    }
  },
  updatedAt: ""
};

function money(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(value);
}

function number(value: number, digits = 4) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits
  }).format(value);
}

function pct(value: number) {
  return `${number(value, 1)}%`;
}

function time(value: string | number) {
  if (!value) return "--:--:--";

  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

function statusClass(status: OpportunityStatus) {
  return `status status-${status}`;
}

function statusLabel(status: OpportunityStatus) {
  const labels: Record<OpportunityStatus, string> = {
    detected: "Detected",
    executed: "Simulated",
    ignored: "Skipped",
    observed: "Watching"
  };

  return labels[status];
}

function scoreLabel(score: number) {
  if (score >= 80) return "Strong";
  if (score >= 50) return "Watch";
  return "Weak";
}

function decisionTone(opportunity?: Opportunity) {
  if (!opportunity) return "wait";
  if (opportunity.status === "executed" || opportunity.status === "detected") return "go";
  if (opportunity.status === "observed") return "watch";
  return "skip";
}

function decisionCopy(opportunity?: Opportunity) {
  if (!opportunity) {
    return {
      eyebrow: "Waiting for data",
      title: "No trade yet",
      detail: "The simulator needs a visible price gap before it can compare risk and profit."
    };
  }

  if (opportunity.status === "executed") {
    return {
      eyebrow: "Trade simulated",
      title: "Passed every safety check",
      detail: "The spread survived fees, slippage, latency, liquidity, and score thresholds."
    };
  }

  if (opportunity.status === "detected") {
    return {
      eyebrow: "Opportunity detected",
      title: "Possible trade found",
      detail: "The bot found a route and is validating whether the profit still exists after risk costs."
    };
  }

  if (opportunity.status === "observed") {
    return {
      eyebrow: "Watch only",
      title: "Interesting, not clean enough",
      detail: "The spread is visible, but the simulator is still waiting for a stronger setup."
    };
  }

  return {
    eyebrow: "Trade skipped",
    title: "Blocked by risk controls",
    detail: "The visible spread was not enough after the simulator subtracted costs and risk."
  };
}

function ageLabel(timestamp: number) {
  const age = Math.max(0, Date.now() - timestamp);
  if (age < 1000) return "fresh";
  return `${number(age, 0)} ms`;
}

function StatTile({
  icon,
  label,
  value,
  caption,
  tone
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  caption: string;
  tone?: "good" | "warn" | "bad";
}) {
  return (
    <section className={`stat-tile ${tone ?? ""}`}>
      <div className="stat-icon">{icon}</div>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
        <span>{caption}</span>
      </div>
    </section>
  );
}

function StoryStep({
  number,
  title,
  detail,
  active
}: {
  number: string;
  title: string;
  detail: string;
  active?: boolean;
}) {
  return (
    <article className={`story-step ${active ? "active" : ""}`}>
      <span>{number}</span>
      <div>
        <strong>{title}</strong>
        <p>{detail}</p>
      </div>
    </article>
  );
}

export default function DashboardPage() {
  const [state, setState] = useState<RadarState>(emptyState);
  const [connected, setConnected] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    let socket: Socket | null = null;
    let active = true;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    async function fetchRadarState() {
      const directUrl = `${SERVER_URL}/state`;
      const proxiedUrl = "/api/state";

      try {
        const response = await fetch(directUrl, { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Server returned ${response.status}`);
        }
        return (await response.json()) as RadarState;
      } catch (directError) {
        const response = await fetch(proxiedUrl, { cache: "no-store" });
        if (!response.ok) {
          throw directError instanceof Error ? directError : new Error(`Server returned ${response.status}`);
        }
        return (await response.json()) as RadarState;
      }
    }

    async function loadState() {
      try {
        const data = await fetchRadarState();
        if (active) {
          setState(data);
          setConnected(true);
          setLastError(null);
        }
      } catch (error) {
        if (active) {
          setConnected(false);
          setLastError(error instanceof Error ? error.message : "Unable to load state");
        }
      }
    }

    void loadState();
    pollTimer = setInterval(() => {
      void loadState();
    }, 2_000);

    socket = io(SERVER_URL, {
      transports: ["websocket", "polling"]
    });

    socket.on("connect", () => {
      setConnected(true);
      setLastError(null);
    });

    socket.on("disconnect", () => {
      setConnected(false);
    });

    socket.on("connect_error", (error) => {
      setConnected(false);
      setLastError(error.message);
    });

    socket.on("radar:update", (payload: RadarState) => {
      setState(payload);
      setLastError(null);
    });

    return () => {
      active = false;
      if (pollTimer) {
        clearInterval(pollTimer);
      }
      socket?.disconnect();
    };
  }, []);

  const bestOpportunity = state.opportunities[0];
  const chartData = useMemo(() => {
    if (state.metrics.pnlSeries.length) {
      return state.metrics.pnlSeries;
    }

    if (state.trades.length) {
      let runningPnl = 0;
      return [...state.trades]
        .reverse()
        .map((trade) => {
          runningPnl += trade.netProfit;
          return {
            time: time(trade.executedAt),
            pnl: Number(runningPnl.toFixed(2))
          };
        });
    }

    return [{ time: "--:--", pnl: 0 }];
  }, [state.metrics.pnlSeries, state.trades]);

  const marketSpread = useMemo(() => {
    if (state.market.length < 2) return null;

    const cheapestAsk = state.market.reduce((best, item) => (item.bestAsk < best.bestAsk ? item : best), state.market[0]);
    const highestBid = state.market.reduce((best, item) => (item.bestBid > best.bestBid ? item : best), state.market[0]);
    const spread = highestBid.bestBid - cheapestAsk.bestAsk;

    return {
      spread,
      buy: cheapestAsk.exchange,
      sell: highestBid.exchange
    };
  }, [state.market]);
  const exchangePriceRows = useMemo(() => {
    return SUPPORTED_EXCHANGES.map((exchange) => ({
      exchange,
      market: state.market.find((item) => item.exchange === exchange),
      balance: state.balances.find((item) => item.exchange === exchange)
    }));
  }, [state.balances, state.market]);

  const paused = state.metrics.pausedUntil ? new Date(state.metrics.pausedUntil) > new Date() : false;
  const decision = decisionCopy(bestOpportunity);
  const tone = decisionTone(bestOpportunity);
  const routeHistory = state.opportunities.slice(0, 8);
  const selectedBuyMarket = bestOpportunity
    ? state.market.find((market) => market.exchange === bestOpportunity.buyExchange)
    : undefined;
  const availableLiquidity = selectedBuyMarket?.askVolume ?? 0;
  const hasFallback = exchangePriceRows.some((item) => item.market?.source === "fallback");
  const safetyChecks = bestOpportunity
    ? [
        {
          icon: <Coins size={18} aria-hidden />,
          label: "Net profit",
          value: money(bestOpportunity.netProfit),
          note: "Target is at least $5.00 after costs",
          state: bestOpportunity.netProfit >= 5 ? "pass" : "fail"
        },
        {
          icon: <ShieldAlert size={18} aria-hidden />,
          label: "Risk score",
          value: `${bestOpportunity.score}/100`,
          note: `${scoreLabel(bestOpportunity.score)} signal quality`,
          state: bestOpportunity.score >= 70 ? "pass" : bestOpportunity.score >= 50 ? "watch" : "fail"
        },
        {
          icon: <Waves size={18} aria-hidden />,
          label: "Slippage",
          value: money(bestOpportunity.slippage),
          note: "Estimated price movement while filling",
          state: bestOpportunity.slippage <= Math.max(0.05, bestOpportunity.grossProfit * 0.35) ? "pass" : "watch"
        },
        {
          icon: <Clock3 size={18} aria-hidden />,
          label: "Latency",
          value: `${number(bestOpportunity.latencyMs, 0)} ms`,
          note: "Lower is safer because spreads disappear fast",
          state: bestOpportunity.latencyMs <= 1000 ? "pass" : "fail"
        },
        {
          icon: <TrendingUp size={18} aria-hidden />,
          label: "Liquidity",
          value: `${number(availableLiquidity)} BTC`,
          note: `Needs ${number(bestOpportunity.volume)} BTC available to buy`,
          state: availableLiquidity >= bestOpportunity.volume ? "pass" : "fail"
        }
      ]
    : [];

  return (
    <main className="shell">
      <section className="demo-hero">
        <div className="hero-topline">
          <span className="brand-mark">
            <Radar size={18} aria-hidden />
            BTC Arbitrage Radar
          </span>
          <div className="hero-status" aria-label="Dashboard status">
            <span className={connected ? "connection online" : "connection offline"}>
              <Activity size={16} aria-hidden />
              {connected ? "Live feed" : "Offline feed"}
            </span>
            <span className="timestamp">
              <RefreshCcw size={15} aria-hidden />
              Updated {time(state.updatedAt)}
            </span>
            <span className={paused ? "connection offline" : "connection ready"}>
              <ShieldCheck size={16} aria-hidden />
              {paused ? "Risk pause" : "Ready"}
            </span>
          </div>
        </div>

        <div className="hero-grid">
          <div className="hero-copy">
            <p className="eyebrow">Live arbitrage demo</p>
            <h1>BTC Arbitrage Radar</h1>
            <p className="hero-lede">
              A presentation-ready simulator that shows the BTC/USDT opportunity, the reason behind the decision,
              and the fake-money result in one clear story.
            </p>
            <div className="proof-strip" aria-label="Live proof points">
              <div>
                <span>Mode</span>
                <strong>Simulation only</strong>
              </div>
              <div>
                <span>Data source</span>
                <strong>{hasFallback ? "Demo fallback" : "Exchange ticker"}</strong>
              </div>
              <div>
                <span>Spread now</span>
                <strong>{marketSpread ? money(marketSpread.spread) : "$0.00"}</strong>
              </div>
            </div>
          </div>

          <aside className={`signal-stage signal-${tone}`} aria-label="Current signal">
            <div className="decision-badge">
              {tone === "go" ? (
                <BadgeCheck size={19} aria-hidden />
              ) : tone === "skip" ? (
                <Ban size={19} aria-hidden />
              ) : (
                <ShieldAlert size={19} aria-hidden />
              )}
              {decision.eyebrow}
            </div>
            <h2>{decision.title}</h2>
            <p>{decision.detail}</p>
            <div className="stage-result">
              <span>{tone === "skip" ? "Blocked estimate" : "Expected result"}</span>
              <strong className={tone === "skip" || (bestOpportunity && bestOpportunity.netProfit < 0) ? "negative" : "positive"}>
                {bestOpportunity ? money(bestOpportunity.netProfit) : "$0.00"}
              </strong>
            </div>
            <div className="score-meter" style={{ "--score": `${bestOpportunity?.score ?? 0}%` } as React.CSSProperties}>
              <b>{bestOpportunity?.score ?? 0}</b>
              <span>quality score</span>
            </div>
          </aside>
        </div>
      </section>

      {lastError ? (
        <div className="notice">
          <CircleAlert size={18} aria-hidden />
          <span>Server connection: {lastError}</span>
        </div>
      ) : null}

      <section className="metrics-grid">
        <StatTile
          icon={<CircleDollarSign size={22} aria-hidden />}
          label="Total simulated profit"
          value={money(state.metrics.cumulativePnl)}
          caption={`Average trade ${money(state.metrics.averageProfit)}`}
          tone={state.metrics.cumulativePnl >= 0 ? "good" : "bad"}
        />
        <StatTile
          icon={<Gauge size={22} aria-hidden />}
          label="Price gaps found"
          value={number(state.metrics.opportunitiesDetected, 0)}
          caption={marketSpread ? `${marketSpread.buy} to ${marketSpread.sell}` : "Waiting for both exchanges"}
        />
        <StatTile
          icon={<WalletCards size={22} aria-hidden />}
          label="Trades simulated"
          value={number(state.metrics.tradesSimulated, 0)}
          caption={`Best result ${money(state.metrics.bestTrade)}`}
        />
        <StatTile
          icon={<PauseCircle size={22} aria-hidden />}
          label="Win rate"
          value={pct(state.metrics.winRate)}
          caption={`${state.metrics.consecutiveLosses} recent losses`}
          tone={state.metrics.winRate >= 60 ? "good" : "warn"}
        />
      </section>

      <section className="story-section">
        <div className="section-title">
          <div>
            <span className="kicker">Demo narrative</span>
            <h2>What the audience sees happen</h2>
          </div>
          <span>{bestOpportunity ? statusLabel(bestOpportunity.status) : "Idle"}</span>
        </div>
        <div className="story-grid">
          <StoryStep
            number="01"
            title="Read exchange prices"
            detail="The simulator streams Binance and Kraken now, while the other configured venues stay visible."
            active={state.market.length > 0}
          />
          <StoryStep
            number="02"
            title="Find the route"
            detail={
              marketSpread
                ? `Buy on ${marketSpread.buy}, sell on ${marketSpread.sell}, then measure the gap.`
                : "Wait for both exchanges before comparing prices."
            }
            active={Boolean(marketSpread)}
          />
          <StoryStep
            number="03"
            title="Subtract the risk"
            detail="Fees, slippage, latency, and available liquidity decide whether the spread is real."
            active={Boolean(bestOpportunity)}
          />
          <StoryStep
            number="04"
            title="Simulate or skip"
            detail={bestOpportunity ? bestOpportunity.reason : "No opportunity has reached the decision stage yet."}
            active={bestOpportunity?.status === "executed" || bestOpportunity?.status === "ignored"}
          />
        </div>
      </section>

      <section className="decision-board">
        <div className="route-panel">
          <div className="section-title">
            <div>
              <span className="kicker">Current route</span>
              <h2>The trade path</h2>
            </div>
            <span>{bestOpportunity ? scoreLabel(bestOpportunity.score) : "Waiting"}</span>
          </div>
          {bestOpportunity ? (
            <div className="route-board">
              <div className="route-step buy-step">
                <span>Buy Bitcoin on</span>
                <strong>{bestOpportunity.buyExchange}</strong>
                <small>{money(bestOpportunity.buyPrice)} per BTC</small>
              </div>
              <ArrowRight size={24} aria-hidden />
              <div className="route-step sell-step">
                <span>Sell Bitcoin on</span>
                <strong>{bestOpportunity.sellExchange}</strong>
                <small>{money(bestOpportunity.sellPrice)} per BTC</small>
              </div>
            </div>
          ) : (
            <div className="empty-state compact">Waiting for exchange prices.</div>
          )}

          {routeHistory.length ? (
            <div className="route-history">
              <div className="route-history-title">
                <span>Route history</span>
                <strong>{routeHistory.length} recent decisions</strong>
              </div>
              <div className="route-history-list">
                {routeHistory.map((opportunity) => (
                  <article className="route-history-row" key={opportunity.id}>
                    <div className="route-history-path">
                      <span>{time(opportunity.createdAt)}</span>
                      <strong>
                        {opportunity.buyExchange} {"->"} {opportunity.sellExchange}
                      </strong>
                      <small>{opportunity.reason}</small>
                    </div>
                    <div className="route-history-metrics">
                      <span className={opportunity.netProfit >= 0 ? "positive" : "negative"}>
                        {money(opportunity.netProfit)}
                      </span>
                      <span>{opportunity.score}/100</span>
                      <span className={statusClass(opportunity.status)}>{statusLabel(opportunity.status)}</span>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ) : (
            <div className="empty-state compact">No route history yet.</div>
          )}
        </div>

        <div className="market-panel">
          <div className="section-title">
            <div>
              <span className="kicker">Exchange prices</span>
              <h2>BTC price board</h2>
            </div>
            <span>{hasFallback ? "Mixed sources" : "Streaming sources"}</span>
          </div>
          <div className="market-list">
            {exchangePriceRows.map(({ exchange, market, balance }) => (
              <article className={`market-row ${market ? "" : "unavailable"}`} key={exchange}>
                <div>
                  <strong>{exchange}</strong>
                  <span>
                    {market
                      ? market.source === "fallback"
                        ? "demo fallback"
                        : "public ticker"
                      : "not streaming"}
                  </span>
                </div>
                <dl>
                  <div>
                    <dt>You can sell for</dt>
                    <dd>{market ? money(market.bestBid) : "--"}</dd>
                  </div>
                  <div>
                    <dt>You can buy for</dt>
                    <dd>{market ? money(market.bestAsk) : "--"}</dd>
                  </div>
                  <div>
                    <dt>{market ? "Available ask" : "Sim balance"}</dt>
                    <dd>{market ? `${number(market.askVolume)} BTC` : balance ? `${number(balance.BTC, 4)} BTC` : "--"}</dd>
                  </div>
                  <div>
                    <dt>{market ? "Data age" : "USDT balance"}</dt>
                    <dd>{market ? ageLabel(market.timestamp) : balance ? money(balance.USDT) : "--"}</dd>
                  </div>
                </dl>
              </article>
            ))}
            {!state.market.length ? <div className="empty-state compact">Waiting for market data</div> : null}
          </div>
        </div>
      </section>

      <section className="insight-grid">
        <div className="chart-panel">
          <div className="section-title">
            <div>
              <span className="kicker">Fake-money result</span>
              <h2>Profit over time</h2>
            </div>
            <span>Worst {money(state.metrics.worstTrade)}</span>
          </div>
          <div className="chart-frame">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 18, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#d9dfd6" strokeDasharray="3 7" />
                <XAxis dataKey="time" tick={{ fontSize: 11 }} stroke="#617064" tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11 }} stroke="#617064" tickLine={false} axisLine={false} />
                <Tooltip
                  formatter={(value) => [money(Number(value)), "P&L"]}
                  contentStyle={{
                    border: "1px solid #c9d4c8",
                    borderRadius: 8,
                    boxShadow: "0 18px 36px rgba(20, 35, 27, 0.16)"
                  }}
                />
                <Line type="monotone" dataKey="pnl" stroke="#0d8b61" strokeWidth={3} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="safety-panel">
          <div className="section-title">
            <div>
              <span className="kicker">Safety checks</span>
              <h2>Why the decision happened</h2>
            </div>
            <span>{bestOpportunity ? statusLabel(bestOpportunity.status) : "Idle"}</span>
          </div>
          {bestOpportunity ? (
            <div className="safety-list">
              {safetyChecks.map((check) => (
                <article className={`safety-card ${check.state}`} key={check.label}>
                  <div className="safety-icon">{check.icon}</div>
                  <div>
                    <span>{check.label}</span>
                    <strong>{check.value}</strong>
                    <small>{check.note}</small>
                  </div>
                </article>
              ))}
              <article className="reason-card">
                <span>Main reason</span>
                <strong>{bestOpportunity.reason}</strong>
              </article>
            </div>
          ) : (
            <div className="empty-state">No safety checks yet because no opportunity is active.</div>
          )}
        </div>
      </section>

      <section className="insight-grid secondary">
        <div className="balances-panel">
          <div className="section-title">
            <div>
              <span className="kicker">Fictitious wallet</span>
              <h2>Balances</h2>
            </div>
            <span>Simulation</span>
          </div>
          <div className="balance-list">
            {state.balances.map((balance) => (
              <div className="balance-row" key={balance.exchange}>
                <div>
                  <Landmark size={18} aria-hidden />
                  <strong>{balance.exchange}</strong>
                </div>
                <dl>
                  <div>
                    <dt>BTC</dt>
                    <dd>{number(balance.BTC, 6)}</dd>
                  </div>
                  <div>
                    <dt>USDT</dt>
                    <dd>{money(balance.USDT)}</dd>
                  </div>
                </dl>
              </div>
            ))}
            {!state.balances.length ? <div className="empty-state compact">Waiting for balances</div> : null}
          </div>
        </div>

        <div className="table-panel">
          <div className="section-title">
            <div>
              <span className="kicker">Recent checks</span>
              <h2>Arbitrage opportunities</h2>
            </div>
            <span>{state.opportunities.length}</span>
          </div>
          <div className="table-wrap tall">
            <table>
              <thead>
                <tr>
                  <th>Buy</th>
                  <th>Sell</th>
                  <th>Profit</th>
                  <th>Score</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {state.opportunities.slice(0, 12).map((opportunity) => (
                  <tr key={opportunity.id}>
                    <td>{opportunity.buyExchange}</td>
                    <td>{opportunity.sellExchange}</td>
                    <td className={opportunity.netProfit >= 0 ? "positive" : "negative"}>
                      {money(opportunity.netProfit)}
                    </td>
                    <td>{opportunity.score}</td>
                    <td>
                      <span className={statusClass(opportunity.status)}>{statusLabel(opportunity.status)}</span>
                    </td>
                  </tr>
                ))}
                {!state.opportunities.length ? (
                  <tr>
                    <td colSpan={5} className="empty-cell">
                      No opportunities detected
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="table-panel final-table">
        <div className="section-title">
          <div>
            <span className="kicker">Executed by simulator</span>
            <h2>Simulated trades</h2>
          </div>
          <span>Best {money(state.metrics.bestTrade)}</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Route</th>
                <th>Volume</th>
                <th>Profit</th>
              </tr>
            </thead>
            <tbody>
              {state.trades.slice(0, 12).map((trade) => (
                <tr key={trade.id}>
                  <td>{time(trade.executedAt)}</td>
                  <td>
                    {trade.buyExchange} {"->"} {trade.sellExchange}
                  </td>
                  <td>{number(trade.volume)} BTC</td>
                  <td className={trade.netProfit >= 0 ? "positive" : "negative"}>{money(trade.netProfit)}</td>
                </tr>
              ))}
              {!state.trades.length ? (
                <tr>
                  <td colSpan={4} className="empty-cell">
                    No simulated trades yet
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
