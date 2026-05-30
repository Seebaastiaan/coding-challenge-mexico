import { buildOpportunity, rankOpportunities } from "./arbitrage.js";
import type { ExchangeName, MarketSnapshot, Opportunity } from "../types.js";

type SnapshotStore = Partial<Record<ExchangeName, MarketSnapshot>>;

export type OpportunityEngineState = {
  snapshots: MarketSnapshot[];
  latestOpportunities: Opportunity[];
};

export function createOpportunityEngine() {
  const snapshots: SnapshotStore = {};
  let latestOpportunities: Opportunity[] = [];

  function processSnapshot(snapshot: MarketSnapshot) {
    snapshots[snapshot.exchange] = snapshot;

    const current = Object.values(snapshots).filter((item): item is MarketSnapshot => Boolean(item));
    const incremental: Opportunity[] = [];

    for (const candidate of current) {
      if (!candidate || candidate.exchange === snapshot.exchange || snapshot.symbol !== candidate.symbol) {
        continue;
      }

      const buyFromSnapshot = buildOpportunity(snapshot, candidate);
      if (buyFromSnapshot) {
        incremental.push(buyFromSnapshot);
      }

      const sellFromSnapshot = buildOpportunity(candidate, snapshot);
      if (sellFromSnapshot) {
        incremental.push(sellFromSnapshot);
      }
    }

    latestOpportunities = rankOpportunities(incremental);
    return latestOpportunities;
  }

  function getMarket() {
    return Object.values(snapshots).filter((item): item is MarketSnapshot => Boolean(item));
  }

  function getOpportunities() {
    return [...latestOpportunities];
  }

  function exportState(): OpportunityEngineState {
    return {
      snapshots: getMarket(),
      latestOpportunities: getOpportunities()
    };
  }

  function restoreState(state: OpportunityEngineState) {
    for (const key of Object.keys(snapshots) as ExchangeName[]) {
      delete snapshots[key];
    }

    for (const snapshot of state.snapshots) {
      snapshots[snapshot.exchange] = { ...snapshot };
    }

    latestOpportunities = state.latestOpportunities.map((opportunity) => ({ ...opportunity }));
  }

  return {
    processSnapshot,
    getMarket,
    getOpportunities,
    exportState,
    restoreState
  };
}
