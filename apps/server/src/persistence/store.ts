import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { InternalEvent } from "../core/contracts.js";
import type { Opportunity, RadarState } from "../types.js";
import type { SimulatorState } from "../simulator/simulator.js";
import type { RiskSnapshot } from "../risk/riskManager.js";
import type { OpportunityEngineState } from "../engine/opportunityEngine.js";

type PersistedEvent = {
  savedAt: string;
  event: InternalEvent;
};

export type PersistedSnapshot = {
  savedAt: string;
  radarState: RadarState;
  recentOpportunities: Opportunity[];
  totalOpportunitiesDetected: number;
  simulatorState: SimulatorState;
  riskState: RiskSnapshot;
  opportunityEngineState: OpportunityEngineState;
};

const PERSISTENCE_DIR = resolve(process.cwd(), process.env.PERSISTENCE_DIR ?? "data");
const EVENTS_FILE = resolve(PERSISTENCE_DIR, "events.jsonl");
const SNAPSHOTS_FILE = resolve(PERSISTENCE_DIR, "snapshots.jsonl");

export function createPersistenceStore() {
  let writeQueue = Promise.resolve();

  async function init() {
    await mkdir(PERSISTENCE_DIR, { recursive: true });
    await ensureFile(EVENTS_FILE);
    await ensureFile(SNAPSHOTS_FILE);
  }

  function enqueueWrite(task: () => Promise<void>) {
    writeQueue = writeQueue.then(task).catch((error) => {
      console.warn(`[persistence] write failed: ${error instanceof Error ? error.message : String(error)}`);
    });
    return writeQueue;
  }

  function appendEvent(event: InternalEvent) {
    const payload: PersistedEvent = {
      savedAt: new Date().toISOString(),
      event
    };

    return enqueueWrite(async () => {
      await appendJsonLine(EVENTS_FILE, payload);
    });
  }

  function appendSnapshot(snapshot: PersistedSnapshot) {
    return enqueueWrite(async () => {
      await appendJsonLine(SNAPSHOTS_FILE, snapshot);
    });
  }

  async function readEvents(limit = 200) {
    const rows = await readJsonLines<PersistedEvent>(EVENTS_FILE);
    return rows.slice(-limit);
  }

  async function readSnapshots(limit = 50) {
    const rows = await readJsonLines<PersistedSnapshot>(SNAPSHOTS_FILE);
    return rows.slice(-limit);
  }

  async function readLatestSnapshot() {
    const rows = await readSnapshots(1);
    return rows.length ? rows[rows.length - 1] : null;
  }

  async function flush() {
    await writeQueue;
  }

  return {
    init,
    appendEvent,
    appendSnapshot,
    readEvents,
    readSnapshots,
    readLatestSnapshot,
    flush,
    files: {
      events: EVENTS_FILE,
      snapshots: SNAPSHOTS_FILE
    }
  };
}

async function ensureFile(filePath: string) {
  await mkdir(dirname(filePath), { recursive: true });

  try {
    await readFile(filePath, "utf8");
  } catch {
    await writeFile(filePath, "", "utf8");
  }
}

async function appendJsonLine(filePath: string, payload: unknown) {
  await appendFile(filePath, `${JSON.stringify(payload)}\n`, "utf8");
}

async function readJsonLines<T>(filePath: string): Promise<T[]> {
  const raw = await readFile(filePath, "utf8");
  if (!raw.trim()) {
    return [];
  }

  const parsed: T[] = [];
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    try {
      parsed.push(JSON.parse(line) as T);
    } catch {
      console.warn(`[persistence] skipping malformed JSONL line ${index + 1} in ${filePath}`);
    }
  }

  return parsed;
}
