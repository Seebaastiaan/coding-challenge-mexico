"use client";

import {
  Activity,
  ArrowRight,
  BadgeCheck,
  Ban,
  ChevronDown,
  CheckCircle2,
  CircleAlert,
  CircleDollarSign,
  Clock3,
  Coins,
  Gauge,
  Landmark,
  LoaderCircle,
  PauseCircle,
  Radar,
  RefreshCcw,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  Wallet,
  WalletCards,
  Waves,
  X,
} from "lucide-react";
import { type CSSProperties, useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type ExchangeName = "Binance" | "Kraken" | "OKX" | "Bybit" | "Coinbase";
type OpportunityStatus = "detected" | "executed" | "ignored" | "observed";
type WalletConnectionStatus = "idle" | "connecting" | "connected";

type WalletOption = {
  name: string;
  network: string;
  address: string;
  accent: string;
  logo: string;
};

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
const walletOptions: WalletOption[] = [
  {
    name: "Phantom",
    network: "Solana",
    address: "7hQ9...Lx2P",
    accent: "#7c3aed",
    logo: "/wallets/phantom.svg",
  },
  {
    name: "Solflare",
    network: "Solana",
    address: "9Kx4...P7mA",
    accent: "#f97316",
    logo: "/wallets/solflare.svg",
  },
  {
    name: "Backpack",
    network: "Solana x EVM",
    address: "2zN8...Qk44",
    accent: "#dc2626",
    logo: "/wallets/backpack.png",
  },
  {
    name: "Glow",
    network: "Solana",
    address: "E2p9...Tn81",
    accent: "#0ea5e9",
    logo: "/wallets/glow.png",
  },
  {
    name: "Ledger",
    network: "Hardware",
    address: "H8m2...R5c9",
    accent: "#0f172a",
    logo: "/wallets/ledger.svg",
  },
];

const emptyState: RadarState = {
  market: [],
  opportunities: [],
  trades: [],
  balances: [],
  metrics: {
    cumulativePnl: 0,
    totalProfitGenerated: 0,
    opportunitiesDetected: 0,
    tradesGenerated: 0,
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
      Coinbase: 0,
    },
  },
  updatedAt: "",
};

function money(value: number) {
  const formatted = new Intl.NumberFormat("es-ES", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

  return `$${formatted}`;
}

function number(value: number, digits = 4) {
  return new Intl.NumberFormat("es-ES", {
    maximumFractionDigits: digits,
  }).format(value);
}

function pct(value: number) {
  return `${number(value, 1)}%`;
}

function time(value: string | number) {
  if (!value) return "--:--:--";

  return new Intl.DateTimeFormat("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function statusClass(status: OpportunityStatus) {
  return `status status-${status}`;
}

function statusLabel(status: OpportunityStatus) {
  const labels: Record<OpportunityStatus, string> = {
    detected: "Detectada",
    executed: "Ejecutada",
    ignored: "Omitida",
    observed: "En observacion",
  };

  return labels[status];
}

function scoreLabel(score: number) {
  if (score >= 80) return "Fuerte";
  if (score >= 50) return "Vigilar";
  return "Debil";
}

function decisionTone(opportunity?: Opportunity) {
  if (!opportunity) return "wait";
  if (opportunity.status === "executed" || opportunity.status === "detected")
    return "go";
  if (opportunity.status === "observed") return "watch";
  return "skip";
}

function decisionCopy(opportunity?: Opportunity) {
  if (!opportunity) {
    return {
      eyebrow: "Esperando datos",
      title: "Aun no hay operacion",
      detail:
        "El motor necesita una brecha de precio visible antes de comparar riesgo y ganancia.",
    };
  }

  if (opportunity.status === "executed") {
    return {
      eyebrow: "Operacion ejecutada",
      title: "Supero todos los controles de seguridad",
      detail:
        "El spread supero comisiones, slippage, latencia, liquidez y umbrales de puntaje.",
    };
  }

  if (opportunity.status === "detected") {
    return {
      eyebrow: "Oportunidad detectada",
      title: "Se encontro una operacion posible",
      detail:
        "El bot encontro una ruta y valida si la ganancia sigue existiendo tras costos de riesgo.",
    };
  }

  if (opportunity.status === "observed") {
    return {
      eyebrow: "Solo observar",
      title: "Interesante, pero no lo bastante limpia",
      detail:
        "El spread es visible, pero el motor sigue esperando una configuracion mas fuerte.",
    };
  }

  return {
    eyebrow: "Operacion omitida",
    title: "Bloqueada por controles de riesgo",
    detail:
      "El spread visible no fue suficiente despues de restar costos y riesgo.",
  };
}

function ageLabel(timestamp: number) {
  const age = Math.max(0, Date.now() - timestamp);
  if (age < 1000) return "reciente";
  return `${number(age, 0)} ms`;
}

function StatTile({
  icon,
  label,
  value,
  caption,
  tone,
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
  active,
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
  const [walletStatus, setWalletStatus] =
    useState<WalletConnectionStatus>("idle");
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [selectedWallet, setSelectedWallet] = useState<WalletOption | null>(
    null,
  );
  const [connectingWallet, setConnectingWallet] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    async function fetchRadarState() {
      const response = await fetch("/api/state", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Serverless route returned ${response.status}`);
      }
      return (await response.json()) as RadarState;
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
          setLastError(
            error instanceof Error ? error.message : "No se pudo cargar el estado",
          );
        }
      }
    }

    void loadState();
    pollTimer = setInterval(() => {
      void loadState();
    }, 2_000);

    return () => {
      active = false;
      if (pollTimer) {
        clearInterval(pollTimer);
      }
    };
  }, []);

  useEffect(() => {
    if (!walletModalOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setWalletModalOpen(false);
      }
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [walletModalOpen]);

  function connectWallet(wallet: WalletOption) {
    setWalletStatus("connecting");
    setConnectingWallet(wallet.name);
    window.setTimeout(() => {
      setSelectedWallet(wallet);
      setWalletStatus("connected");
      setConnectingWallet(null);
      setWalletModalOpen(false);
    }, 700);
  }

  function disconnectWallet() {
    setSelectedWallet(null);
    setWalletStatus("idle");
    setConnectingWallet(null);
  }

  const bestOpportunity = state.opportunities[0];
  const profitChart = useMemo(() => {
    if (state.trades.length) {
      let runningPnl = 0;
      const recentTrades = state.trades.slice(0, 30).reverse();
      const data = recentTrades.map((trade, index) => {
        runningPnl += trade.netProfit;
        return {
          time: `${time(trade.executedAt)} #${index + 1}`,
          value: Number(runningPnl.toFixed(4)),
        };
      });

      return {
        data,
        label: "Ganancia acumulada reciente",
        kicker: "Resultado reciente de spread",
        badge: `${recentTrades.length} operaciones, ${money(runningPnl)}`,
      };
    }

    if (state.opportunities.length) {
      return {
        data: state.opportunities
          .slice(0, 30)
          .reverse()
          .map((opportunity) => ({
            time: time(opportunity.createdAt),
            value: Number(opportunity.netProfit.toFixed(2)),
          })),
        label: "Ganancia estimada",
        kicker: "Estimaciones de senales",
        badge: "Aun no hay operaciones generadas",
      };
    }

    return {
      data: [
        { time: "--:--", value: 0 },
        { time: "--:--", value: 0 },
      ],
      label: "PyG",
      kicker: "Esperando datos",
      badge: "Sin datos para la grafica",
    };
  }, [
    state.metrics.pnlSeries,
    state.metrics.worstTrade,
    state.opportunities,
    state.trades,
  ]);

  const marketSpread = useMemo(() => {
    if (state.market.length < 2) return null;

    const cheapestAsk = state.market.reduce(
      (best, item) => (item.bestAsk < best.bestAsk ? item : best),
      state.market[0],
    );
    const highestBid = state.market.reduce(
      (best, item) => (item.bestBid > best.bestBid ? item : best),
      state.market[0],
    );
    const spread = highestBid.bestBid - cheapestAsk.bestAsk;

    return {
      spread,
      buy: cheapestAsk.exchange,
      sell: highestBid.exchange,
    };
  }, [state.market]);
  const exchangePriceRows = useMemo(() => {
    return SUPPORTED_EXCHANGES.map((exchange) => ({
      exchange,
      market: state.market.find((item) => item.exchange === exchange),
      balance: state.balances.find((item) => item.exchange === exchange),
    }));
  }, [state.balances, state.market]);

  const paused = state.metrics.pausedUntil
    ? new Date(state.metrics.pausedUntil) > new Date()
    : false;
  const decision = decisionCopy(bestOpportunity);
  const tone = decisionTone(bestOpportunity);
  const routeHistory = state.opportunities.slice(0, 8);
  const selectedBuyMarket = bestOpportunity
    ? state.market.find(
        (market) => market.exchange === bestOpportunity.buyExchange,
      )
    : undefined;
  const availableLiquidity = selectedBuyMarket?.askVolume ?? 0;
  const hasFallback = exchangePriceRows.some(
    (item) => item.market?.source === "fallback",
  );
  const safetyChecks = bestOpportunity
    ? [
        {
          icon: <Coins size={18} aria-hidden />,
          label: "Ganancia neta",
          value: money(bestOpportunity.netProfit),
          note: "Objetivo: al menos $5.00 despues de costos",
          state: bestOpportunity.netProfit >= 5 ? "pass" : "fail",
        },
        {
          icon: <ShieldAlert size={18} aria-hidden />,
          label: "Puntaje de riesgo",
          value: `${bestOpportunity.score}/100`,
          note: `${scoreLabel(bestOpportunity.score)} signal quality`,
          state:
            bestOpportunity.score >= 70
              ? "pass"
              : bestOpportunity.score >= 50
                ? "watch"
                : "fail",
        },
        {
          icon: <Waves size={18} aria-hidden />,
          label: "Slippage",
          value: money(bestOpportunity.slippage),
          note: "Movimiento de precio estimado al ejecutar",
          state:
            bestOpportunity.slippage <=
            Math.max(0.05, bestOpportunity.grossProfit * 0.35)
              ? "pass"
              : "watch",
        },
        {
          icon: <Clock3 size={18} aria-hidden />,
          label: "Latencia",
          value: `${number(bestOpportunity.latencyMs, 0)} ms`,
          note: "Mas baja es mas segura porque los spreads desaparecen rapido",
          state: bestOpportunity.latencyMs <= 1000 ? "pass" : "fail",
        },
        {
          icon: <TrendingUp size={18} aria-hidden />,
          label: "Liquidez",
          value: `${number(availableLiquidity)} BTC`,
          note: `Necesita ${number(bestOpportunity.volume)} BTC disponibles para comprar`,
          state: availableLiquidity >= bestOpportunity.volume ? "pass" : "fail",
        },
      ]
    : [];
  const walletButtonLabel = selectedWallet
    ? `Conectada a la cartera simulada ${selectedWallet.name}`
    : "Abrir modal de conexion de cartera simulada";

  return (
    <main className="shell">
      <section className="ops-main">
        <header className="ops-topbar">
          <div>
            <span className="brand-mark">
              <Radar size={18} aria-hidden />
              Radar de Arbitraje BTC
            </span>
            <h1>Centro de mando de arbitraje</h1>
          </div>
          <div className="hero-status" aria-label="Estado del panel">
            <span
              className={connected ? "connection online" : "connection offline"}
            >
              <Activity size={16} aria-hidden />
              {connected ? "Flujo en vivo" : "Flujo sin conexion"}
            </span>
            <span className="timestamp">
              <RefreshCcw size={15} aria-hidden />
              Actualizado {time(state.updatedAt)}
            </span>
            <span className="connection online">
              <CircleDollarSign size={16} aria-hidden />
              Ganancia {money(state.metrics.totalProfitGenerated)}
            </span>
            <button
              aria-label={walletButtonLabel}
              aria-haspopup="dialog"
              className={`wallet-launcher wallet-${walletStatus}`}
              onClick={() => setWalletModalOpen(true)}
              type="button"
            >
              <span className="wallet-launcher-icon">
                {selectedWallet ? (
                  <img src={selectedWallet.logo} alt="" aria-hidden />
                ) : (
                  <Wallet size={18} aria-hidden />
                )}
              </span>
              <span className="wallet-launcher-copy">
                  <strong>
                  {selectedWallet ? selectedWallet.name : "Conectar cartera"}
                </strong>
                {selectedWallet ? <em>{selectedWallet.address}</em> : null}
              </span>
              <small>Demostracion</small>
            </button>
            <span
              className={paused ? "connection offline" : "connection ready"}
            >
              <ShieldCheck size={16} aria-hidden />
              {paused ? "Pausa de riesgo" : "Lista"}
            </span>
          </div>
        </header>

        {walletModalOpen ? (
          <div
            aria-labelledby="wallet-modal-title"
            aria-modal="true"
            className="wallet-modal-backdrop"
            onClick={() => setWalletModalOpen(false)}
            role="dialog"
          >
            <div
              className="wallet-modal"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="wallet-modal-head">
                <div>
                  <span className="kicker">Acceso a cartera simulada</span>
                  <h2 id="wallet-modal-title">Conectar una cartera</h2>
                </div>
                <button
                  aria-label="Cerrar modal de conexion de cartera"
                  className="wallet-close"
                  onClick={() => setWalletModalOpen(false)}
                  type="button"
                >
                  <X size={18} aria-hidden />
                </button>
              </div>

              <div className="wallet-modal-status">
                <Wallet size={19} aria-hidden />
                <div>
                  <strong>
                    {selectedWallet
                      ? `${selectedWallet.name} conectada`
                      : "Elige tu cartera"}
                  </strong>
                  <span>
                    {selectedWallet
                      ? `${selectedWallet.address} en ${selectedWallet.network}`
                      : "Este es un flujo de conexion simulado para la demostracion del panel."}
                  </span>
                </div>
              </div>

              <div className="wallet-options">
                {walletOptions.map((wallet) => {
                  const isConnected = selectedWallet?.name === wallet.name;
                  const isConnecting =
                    walletStatus === "connecting" &&
                    connectingWallet === wallet.name;

                  return (
                    <button
                      className={`wallet-option ${isConnected ? "selected" : ""}`}
                      disabled={isConnecting}
                      key={wallet.name}
                      onClick={() => connectWallet(wallet)}
                      style={
                        {
                          "--wallet-accent": wallet.accent,
                        } as CSSProperties
                      }
                      type="button"
                    >
                  <span className="wallet-option-mark">
                        <img src={wallet.logo} alt={`${wallet.name} logo`} />
                      </span>
                      <span className="wallet-option-copy">
                        <strong>{wallet.name}</strong>
                        <small>{wallet.network}</small>
                      </span>
                      <span className="wallet-option-action">
                        {isConnecting ? (
                          <LoaderCircle
                            className="wallet-spinner"
                            size={17}
                            aria-hidden
                          />
                        ) : isConnected ? (
                          <CheckCircle2 size={18} aria-hidden />
                        ) : (
                          "Conectar"
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="wallet-modal-actions">
                <button
                  className="wallet-secondary-action"
                  disabled={!selectedWallet}
                  onClick={disconnectWallet}
                  type="button"
                >
                  Desconectar
                </button>
                <button
                  className="wallet-primary-action"
                  onClick={() => setWalletModalOpen(false)}
                  type="button"
                >
                  Listo
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {lastError ? (
          <div className="notice">
            <CircleAlert size={18} aria-hidden />
            <span>Conexion del servidor: {lastError}</span>
          </div>
        ) : null}

        <div className="ops-grid">
          <aside
            className={`ops-card ops-signal signal-${tone}`}
            aria-label="Current signal"
          >
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
            <div className="ops-result">
              <span>
                  {tone === "skip" ? "Ganancia bloqueada" : "Ganancia de ruta"}
              </span>
              <strong
                className={
                  tone === "skip" ||
                  (bestOpportunity && bestOpportunity.netProfit < 0)
                    ? "negative"
                    : "positive"
                }
              >
                {bestOpportunity ? money(bestOpportunity.netProfit) : "$0.00"}
              </strong>
            </div>
            <div className="ops-signal-meta">
              <div>
                <span>Calidad</span>
                <strong>{bestOpportunity?.score ?? 0}/100</strong>
              </div>
              <div>
                <span>Spread</span>
                <strong>
                  {marketSpread ? money(marketSpread.spread) : "$0.00"}
                </strong>
              </div>
              <div>
                <span>Fuente</span>
                <strong>{hasFallback ? "Mixta" : "En vivo"}</strong>
              </div>
            </div>
          </aside>

          <section className="ops-card ops-route">
            <div className="section-title">
              <div>
                <span className="kicker">Ruta actual</span>
                <h2>
                  {bestOpportunity
                    ? `${bestOpportunity.buyExchange} -> ${bestOpportunity.sellExchange}`
                    : "Esperando ruta"}
                </h2>
              </div>
              <span>
                {bestOpportunity ? scoreLabel(bestOpportunity.score) : "Inactiva"}
              </span>
            </div>
            {bestOpportunity ? (
              <div className="route-board compact">
                <div className="route-step buy-step">
                  <span>Compra</span>
                  <strong>{bestOpportunity.buyExchange}</strong>
                  <small>{money(bestOpportunity.buyPrice)}</small>
                </div>
                <ArrowRight size={22} aria-hidden />
                <div className="route-step sell-step">
                  <span>Venta</span>
                  <strong>{bestOpportunity.sellExchange}</strong>
                  <small>{money(bestOpportunity.sellPrice)}</small>
                </div>
              </div>
            ) : (
              <div className="empty-state compact">
                Esperando precios de exchanges.
              </div>
            )}

            <div className="ops-chart-head">
              <span>{profitChart.kicker}</span>
              <strong>{profitChart.badge}</strong>
            </div>
            <div className="chart-frame ops-chart">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={profitChart.data}
                  margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
                >
                  <CartesianGrid stroke="#d9dfd6" strokeDasharray="3 7" />
                  <XAxis
                    dataKey="time"
                    tick={{ fontSize: 11 }}
                    stroke="#617064"
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    stroke="#617064"
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    formatter={(value) => [
                      money(Number(value)),
                      profitChart.label,
                    ]}
                    contentStyle={{
                      border: "1px solid #c9d4c8",
                      borderRadius: 8,
                      boxShadow: "0 18px 36px rgba(20, 35, 27, 0.16)",
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="#0d8b61"
                    strokeWidth={3}
                    dot={profitChart.data.length < 4}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="ops-card ops-market">
            <div className="section-title">
              <div>
                <span className="kicker">Precios de exchanges</span>
                <h2>Panel BTC</h2>
              </div>
              <span>{hasFallback ? "Mixta" : "En vivo"}</span>
            </div>
            <div className="market-list compact">
              {exchangePriceRows.map(({ exchange, market, balance }) => (
                <article
                  className={`market-row ${market ? "" : "unavailable"}`}
                  key={exchange}
                >
                  <div>
                    <strong>{exchange}</strong>
                    <span>
                      {market
                        ? market.source === "fallback"
                          ? "fallback"
                          : "ticker"
                        : "sin flujo"}
                    </span>
                  </div>
                  <dl>
                    <div>
                      <dt>Bid</dt>
                      <dd>{market ? money(market.bestBid) : "--"}</dd>
                    </div>
                    <div>
                      <dt>Ask</dt>
                      <dd>{market ? money(market.bestAsk) : "--"}</dd>
                    </div>
                    <div>
                      <dt>{market ? "Edad" : "USDT"}</dt>
                      <dd>
                        {market
                          ? ageLabel(market.timestamp)
                          : balance
                            ? money(balance.USDT)
                            : "--"}
                      </dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
          </section>
        </div>

        <section className="metrics-grid ops-metrics">
          <StatTile
            icon={<CircleDollarSign size={22} aria-hidden />}
            label="Ganancia total generada"
            value={money(state.metrics.totalProfitGenerated)}
            caption={`Promedio por operacion ${money(state.metrics.averageProfit)}`}
            tone={state.metrics.totalProfitGenerated >= 0 ? "good" : "bad"}
          />
          <StatTile
            icon={<Gauge size={22} aria-hidden />}
            label="Brechas de precio encontradas"
            value={number(state.metrics.opportunitiesDetected, 0)}
            caption={
              marketSpread
                ? `${marketSpread.buy} a ${marketSpread.sell}`
                : "Esperando exchanges"
            }
          />
          <StatTile
            icon={<WalletCards size={22} aria-hidden />}
            label="Operaciones generadas"
            value={number(state.metrics.tradesGenerated, 0)}
            caption={`Mejor resultado ${money(state.metrics.bestTrade)}`}
          />
          <StatTile
            icon={<PauseCircle size={22} aria-hidden />}
            label="Tasa de acierto"
            value={pct(state.metrics.winRate)}
            caption={`${state.metrics.consecutiveLosses} perdidas recientes`}
            tone={state.metrics.winRate >= 60 ? "good" : "warn"}
          />
        </section>
        <div className="scroll-cue" aria-hidden="true">
          <ChevronDown size={18} />
        </div>
      </section>

      <section className="decision-board secondary-board">
        <div className="route-panel">
          <div className="section-title">
            <div>
               <span className="kicker">Historial de rutas</span>
               <h2>Decisiones recientes de ruta</h2>
            </div>
            <span>{routeHistory.length}</span>
          </div>
          {routeHistory.length ? (
            <div className="route-history-list">
              {routeHistory.map((opportunity) => (
                <article className="route-history-row" key={opportunity.id}>
                  <div className="route-history-path">
                    <span>{time(opportunity.createdAt)}</span>
                    <strong>
                      {opportunity.buyExchange} {"->"}{" "}
                      {opportunity.sellExchange}
                    </strong>
                    <small>{opportunity.reason}</small>
                  </div>
                  <div className="route-history-metrics">
                    <span
                      className={
                        opportunity.netProfit >= 0 ? "positive" : "negative"
                      }
                    >
                      {money(opportunity.netProfit)}
                    </span>
                    <span>{opportunity.score}/100</span>
                    <span className={statusClass(opportunity.status)}>
                      {statusLabel(opportunity.status)}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state compact">Aun no hay historial de rutas.</div>
          )}
        </div>

        <div className="safety-panel">
          <div className="section-title">
            <div>
               <span className="kicker">Validaciones de decision</span>
               <h2>Por que ocurrio</h2>
             </div>
             <span>
               {bestOpportunity ? statusLabel(bestOpportunity.status) : "Inactiva"}
             </span>
           </div>
          {bestOpportunity ? (
            <div className="safety-list">
              {safetyChecks.map((check) => (
                <article
                  className={`safety-card ${check.state}`}
                  key={check.label}
                >
                  <div className="safety-icon">{check.icon}</div>
                  <div>
                    <span>{check.label}</span>
                    <strong>{check.value}</strong>
                    <small>{check.note}</small>
                  </div>
                </article>
              ))}
              <article className="reason-card">
                 <span>Motivo principal</span>
                 <strong>{bestOpportunity.reason}</strong>
               </article>
             </div>
           ) : (
             <div className="empty-state compact">No hay oportunidad activa.</div>
           )}
         </div>
      </section>

      <section className="insight-grid secondary">
        <div className="balances-panel">
          <div className="section-title">
            <div>
               <span className="kicker">Libro de exchanges</span>
               <h2>Saldos</h2>
             </div>
             <span>Libro en vivo</span>
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
            {!state.balances.length ? (
               <div className="empty-state compact">Esperando saldos</div>
             ) : null}
           </div>
         </div>

        <div className="table-panel">
          <div className="section-title">
            <div>
               <span className="kicker">Validaciones recientes</span>
               <h2>Oportunidades de arbitraje</h2>
             </div>
             <span>{state.opportunities.length}</span>
           </div>
          <div className="table-wrap tall">
            <table>
              <thead>
                <tr>
                   <th>Compra</th>
                   <th>Venta</th>
                   <th>Ganancia</th>
                   <th>Puntaje</th>
                   <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {state.opportunities.slice(0, 12).map((opportunity) => (
                  <tr key={opportunity.id}>
                    <td>{opportunity.buyExchange}</td>
                    <td>{opportunity.sellExchange}</td>
                    <td
                      className={
                        opportunity.netProfit >= 0 ? "positive" : "negative"
                      }
                    >
                      {money(opportunity.netProfit)}
                    </td>
                    <td>{opportunity.score}</td>
                    <td>
                      <span className={statusClass(opportunity.status)}>
                        {statusLabel(opportunity.status)}
                      </span>
                    </td>
                  </tr>
                ))}
                {!state.opportunities.length ? (
                  <tr>
                    <td colSpan={5} className="empty-cell">
                       No se detectaron oportunidades
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
             <span className="kicker">Ejecuciones generadas</span>
             <h2>Libro de operaciones</h2>
           </div>
           <span>Mejor {money(state.metrics.bestTrade)}</span>
         </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                 <th>Hora</th>
                 <th>Ruta</th>
                 <th>Volumen</th>
                 <th>Ganancia</th>
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
                  <td
                    className={trade.netProfit >= 0 ? "positive" : "negative"}
                  >
                    {money(trade.netProfit)}
                  </td>
                </tr>
              ))}
              {!state.trades.length ? (
                <tr>
                  <td colSpan={4} className="empty-cell">
                     Aun no hay operaciones generadas
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
