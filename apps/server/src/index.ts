import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import {
  ENABLE_LIVE_TRADING,
  ENABLE_SANDBOX_TRADING,
  EXECUTION_MODE,
  PORT,
  RUNTIME_PROFILE,
  WEB_ORIGIN
} from "./config.js";
import { createEventBus } from "./core/eventBus.js";
import { createOpportunityEngine } from "./engine/opportunityEngine.js";
import { createExecutionEngine } from "./execution/executionEngine.js";
import { createRuntimeGuard } from "./guard/runtimeGuard.js";
import { createPersistenceStore } from "./persistence/store.js";
import { createRiskManager } from "./risk/riskManager.js";
import { createLiveReadinessController } from "./rollout/liveReadiness.js";
import { createMarketDataStream } from "./services/marketData.js";
import { exportSimulatorState, getBalances, getMetrics, getTrades, recordOpportunity, restoreSimulatorState } from "./simulator/simulator.js";
import { createTelemetry } from "./telemetry/telemetry.js";
import type { Opportunity, RadarState, MarketSnapshot } from "./types.js";

const app = express();
const httpServer = createServer(app);
const eventBus = createEventBus();
const opportunityEngine = createOpportunityEngine();
const riskManager = createRiskManager();
const runtimeGuard = createRuntimeGuard();
const liveReadiness = createLiveReadinessController();
const executionEngine = createExecutionEngine(eventBus).withRiskManager(
  riskManager,
  getBalances,
  runtimeGuard.isExchangeAllowed,
  liveReadiness.evaluateOpportunity
);
const persistence = createPersistenceStore();
const telemetry = createTelemetry();
const io = new Server(httpServer, {
  cors: {
    origin: WEB_ORIGIN,
    methods: ["GET"]
  }
});

let recentOpportunities: Opportunity[] = [];
let totalOpportunitiesDetected = 0;
let lastInternalEventAt = Date.now();
const eventCounters: Record<string, number> = {};
let currentState: RadarState = {
  market: [],
  opportunities: [],
  trades: [],
  balances: getBalances(),
  metrics: getMetrics(0),
  updatedAt: new Date().toISOString()
};

app.use(cors({ origin: WEB_ORIGIN }));
app.use(express.json());

app.get("/health", (_request, response) => {
  response.json({ ok: true, updatedAt: currentState.updatedAt });
});

app.get("/health/deep", (_request, response) => {
  const telemetrySnapshot = telemetry.getSnapshot();
  const guardState = runtimeGuard.getState();
  const rolloutPolicy = liveReadiness.getPolicy();
  response.json({
    ok: true,
    profile: RUNTIME_PROFILE,
    executionMode: EXECUTION_MODE,
    liveEnabled: ENABLE_LIVE_TRADING,
    sandboxEnabled: ENABLE_SANDBOX_TRADING,
    updatedAt: currentState.updatedAt,
    lastInternalEventAt: new Date(lastInternalEventAt).toISOString(),
    eventCounters,
    telemetry: telemetrySnapshot,
    runtimeGuard: guardState,
    rollout: {
      stage: liveReadiness.getStage(),
      policy: rolloutPolicy
    }
  });
});

app.get("/metrics", (_request, response) => {
  response.setHeader("Content-Type", "text/plain; version=0.0.4");
  response.send(telemetry.renderPrometheus());
});

app.get("/state", (_request, response) => {
  response.json(currentState);
});

app.get("/risk/state", (_request, response) => {
  response.json(riskManager.getState());
});

app.post("/risk/kill-switch", (request, response) => {
  const reason = typeof request.body?.reason === "string" && request.body.reason.trim().length
    ? request.body.reason.trim()
    : "Activacion manual de kill switch";

  riskManager.killSwitch(reason);
  response.json({ ok: true, state: riskManager.getState() });
});

app.delete("/risk/kill-switch", (_request, response) => {
  riskManager.clearKillSwitch();
  response.json({ ok: true, state: riskManager.getState() });
});

app.get("/replay/events", async (request, response) => {
  const limit = Number(request.query.limit ?? 200);
  const events = await persistence.readEvents(Number.isFinite(limit) ? Math.max(1, Math.min(limit, 5000)) : 200);
  response.json({ count: events.length, events });
});

app.get("/replay/snapshots", async (request, response) => {
  const limit = Number(request.query.limit ?? 50);
  const snapshots = await persistence.readSnapshots(Number.isFinite(limit) ? Math.max(1, Math.min(limit, 1000)) : 50);
  response.json({ count: snapshots.length, snapshots });
});

app.get("/guard/state", (_request, response) => {
  response.json(runtimeGuard.getState());
});

app.post("/guard/alerts", (request, response) => {
  const message = typeof request.body?.message === "string" && request.body.message.trim().length
    ? request.body.message.trim()
    : "Alerta manual del guardia de ejecucion";
  runtimeGuard.addManualAlert(message);
  response.json({ ok: true, state: runtimeGuard.getState() });
});

app.delete("/guard/alerts", (_request, response) => {
  runtimeGuard.clearAlerts();
  response.json({ ok: true, state: runtimeGuard.getState() });
});

app.get("/rollout/stage", (_request, response) => {
  response.json({
    stage: liveReadiness.getStage(),
    policy: liveReadiness.getPolicy(),
    availableStages: liveReadiness.listStages()
  });
});

app.post("/rollout/stage", (request, response) => {
  const stage = request.body?.stage;
  if (typeof stage !== "string" || !liveReadiness.listStages().includes(stage as never)) {
    response.status(400).json({
      ok: false,
      error: "Etapa invalida",
      availableStages: liveReadiness.listStages()
    });
    return;
  }

  const policy = liveReadiness.setStage(stage as ReturnType<typeof liveReadiness.getStage>);
  runtimeGuard.addManualAlert(`La etapa de despliegue cambio a ${policy.stage}`);
  response.json({ ok: true, stage: policy.stage, policy });
});

app.get("/rollout/preflight", (_request, response) => {
  const report = liveReadiness.preflight({
    telemetry: telemetry.getSnapshot(),
    risk: riskManager.getState(),
    runtimeGuard: runtimeGuard.getState(),
    eventCounters
  });

  response.json(report);
});

io.on("connection", (socket) => {
  socket.emit("radar:update", currentState);
});

eventBus.onAny((event) => {
  lastInternalEventAt = Date.now();
  eventCounters[event.kind] = (eventCounters[event.kind] ?? 0) + 1;
  telemetry.recordEvent(event);
  void persistence.appendEvent(event);
});

setInterval(() => {
  runtimeGuard.updateFromTelemetry(telemetry.getSnapshot());
}, 3_000);

let snapshotsSincePersist = 0;

function persistCurrentSnapshot() {
  const payload = {
    savedAt: new Date().toISOString(),
    radarState: currentState,
    recentOpportunities,
    totalOpportunitiesDetected,
    simulatorState: exportSimulatorState(),
    riskState: riskManager.exportState(),
    opportunityEngineState: opportunityEngine.exportState()
  };

  void persistence.appendSnapshot(payload);
}

async function processMarketSnapshots(snapshots: MarketSnapshot[]) {
  for (const snapshot of snapshots) {
    eventBus.emit({
      kind: "market.book_top",
      exchange: snapshot.exchange,
      pair: snapshot.symbol,
      snapshot,
      observedAtMs: Date.now(),
      source: snapshot.source === "live" ? "ws" : "fallback"
    });
    telemetry.markExchangeHeartbeat(snapshot.exchange);
    const rawOpportunities = opportunityEngine.processSnapshot(snapshot);
    const processedOpportunities = await Promise.all(rawOpportunities.map(async (opportunity) => {
      recordOpportunity(opportunity);
      totalOpportunitiesDetected += 1;
      eventBus.emit({
        kind: "opportunity.detected",
        opportunity,
        detectedAtMs: Date.now(),
        decisionLatencyMs: opportunity.latencyMs
      });
      return executionEngine.executeOpportunity(opportunity);
    }));

    recentOpportunities = [...processedOpportunities, ...recentOpportunities].slice(0, 100);
    currentState = {
      market: opportunityEngine.getMarket(),
      opportunities: recentOpportunities,
      trades: getTrades(),
      balances: getBalances(),
      metrics: getMetrics(totalOpportunitiesDetected),
      updatedAt: new Date().toISOString()
    };

    io.emit("radar:update", currentState);

    snapshotsSincePersist += 1;
    if (snapshotsSincePersist >= 5) {
      persistCurrentSnapshot();
      snapshotsSincePersist = 0;
    }
  }
}

async function bootstrapAndListen() {
  await persistence.init();

  const latestSnapshot = await persistence.readLatestSnapshot();
  if (latestSnapshot) {
    restoreSimulatorState(latestSnapshot.simulatorState);
    riskManager.restoreState(latestSnapshot.riskState);
    opportunityEngine.restoreState(latestSnapshot.opportunityEngineState);
    recentOpportunities = latestSnapshot.recentOpportunities;
    totalOpportunitiesDetected = latestSnapshot.totalOpportunitiesDetected;
    currentState = latestSnapshot.radarState;
  }

  httpServer.listen(PORT, () => {
    eventBus.emit({
      kind: "system.health",
      profile: RUNTIME_PROFILE,
      healthy: true,
      details: "Inicio del servidor completado",
      atMs: Date.now()
    });
    console.log(`Servidor Radar de Arbitraje BTC escuchando en http://localhost:${PORT}`);

    const stopMarketStream = createMarketDataStream(
      (snapshots) => {
        void processMarketSnapshots(snapshots);
      },
      (exchange, message) => {
        telemetry.recordExchangeStatus(exchange, message);
      }
    );

    process.on("SIGINT", () => {
      stopMarketStream();
      persistCurrentSnapshot();
      void persistence.flush().finally(() => {
        process.exit(0);
      });
    });

    process.on("SIGTERM", () => {
      stopMarketStream();
      persistCurrentSnapshot();
      void persistence.flush().finally(() => {
        process.exit(0);
      });
    });
  });
}

void bootstrapAndListen().catch((error) => {
  console.error(`[bootstrap] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
