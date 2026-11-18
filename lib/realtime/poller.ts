// Server-side PRIM poller: one instance per process (globalThis), quota-safe, persisted, with a replay mode.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Disruption, Journey, Network, Snapshot } from '../types';
import { isActiveAt, parseDisruptions } from './disruptions';
import { fetchDisruptions, fetchEstimatedTimetable } from './prim-client';
import { buildRuns } from './runs';
import { nextDelayMs } from './schedule';
import { parseEstimatedTimetable } from './siri';
import { callsToday, loadDisruptions, loadSnapshot, recordCall, saveDisruptions, saveSnapshot } from './store';

const ET_INTERVAL_MS = 100_000;
const DISRUPTIONS_INTERVAL_MS = 5 * 60_000;
const DAILY_CAP = 900;
const RECHECK_MS = 5 * 60_000; // cap reached or outside the service window
const MIN_LOOP_MS = 1_000;

let networkCache: Network | null = null;

/** Static network, read once per process from public/data/network.json. */
export function getNetwork(): Network {
  networkCache ??= JSON.parse(readFileSync(path.join(process.cwd(), 'public/data/network.json'), 'utf8')) as Network;
  return networkCache;
}

export interface PollerDeps {
  now: () => number;
  fetchEt: () => Promise<unknown>;
  fetchDisruptions: () => Promise<unknown>;
  dir: string;
  live: boolean;
}

export interface PollerStatus { mode: 'live' | 'replay'; lastFetch: number | null; callsToday: number; failures: number }

const shift = (journeys: Journey[], offset: number): Journey[] =>
  journeys.map((j) => ({
    ...j,
    calls: j.calls.map((c) => ({
      quay: c.quay,
      arr: c.arr === null ? null : c.arr + offset,
      dep: c.dep === null ? null : c.dep + offset,
    })),
  }));

export class Poller {
  private readonly deps: PollerDeps;
  private current: Snapshot | null = null;
  private lastFetch: number | null = null; // last successful fetch (or persisted snapshot)
  private lastAttempt: number | null = null; // last PRIM call, successful or not: drives the schedule
  private failures = 0;
  private cachedDisruptions: Disruption[] = [];
  private disruptionsAttempt: number | null = null; // last disruptions call, successful or not
  private disruptionsFailures = 0;
  private replayDisruptions: Disruption[] | null = null;
  private replayJourneys: Journey[] | null = null;
  private started = false;

  constructor(deps: Partial<PollerDeps> = {}) {
    const apiKey = process.env.PRIM_API_KEY;
    let live = deps.live ?? (process.env.PRIM_LIVE === '1' || process.env.NODE_ENV === 'production');
    if (live && !deps.fetchEt && !apiKey) {
      console.error('[poller] PRIM_API_KEY manquante : repli sur le mode replay');
      live = false;
    }
    this.deps = {
      now: deps.now ?? Date.now,
      fetchEt: deps.fetchEt ?? (() => fetchEstimatedTimetable(apiKey ?? '')),
      fetchDisruptions: deps.fetchDisruptions ?? (() => fetchDisruptions(apiKey ?? '')),
      dir: deps.dir ?? path.join(process.cwd(), '.cache'),
      live,
    };
    if (live) {
      const stored = loadSnapshot(this.deps.dir);
      if (stored) {
        this.current = { fetchedAt: stored.fetchedAt, source: 'cache', runs: stored.runs };
        this.lastFetch = this.lastAttempt = stored.fetchedAt;
      }
      const storedDisr = loadDisruptions(this.deps.dir);
      this.cachedDisruptions = storedDisr?.disruptions ?? [];
      this.disruptionsAttempt = storedDisr?.fetchedAt ?? null;
    }
  }

  /** Starts the polling loop once; later calls are no-ops. */
  start(): void {
    if (this.started) return;
    this.started = true;
    const loop = async () => {
      let delay = RECHECK_MS;
      try {
        delay = await this.tick();
      } catch (e) {
        console.error('[poller] tick failed', e);
      }
      const timer = setTimeout(loop, Math.max(MIN_LOOP_MS, delay));
      timer.unref?.();
    };
    void loop();
  }

  /** One scheduling step: calls PRIM (or rebuilds the replay) if due. Returns the delay until the next step. */
  async tick(): Promise<number> {
    if (!this.deps.live) return this.tickReplay();
    const etDelay = await this.tickLive();
    const disruptionsDelay = await this.tickDisruptions();
    return Math.min(etDelay, disruptionsDelay);
  }

  snapshot(): Snapshot | null {
    return this.current;
  }

  /** Disruptions known from the last poll; in live mode, periods that ended since then are dropped. */
  disruptions(): Disruption[] {
    if (!this.deps.live) return this.cachedDisruptions;
    const now = this.deps.now();
    return this.cachedDisruptions.filter((d) => isActiveAt(d, now));
  }

  status(): PollerStatus {
    return {
      mode: this.deps.live ? 'live' : 'replay',
      lastFetch: this.lastFetch,
      callsToday: callsToday(this.deps.dir, 'et', this.deps.now()),
      failures: this.failures,
    };
  }

  private schedule(now: number): number | null {
    return nextDelayMs(now, {
      lastFetch: this.lastAttempt,
      failures: this.failures,
      callsToday: callsToday(this.deps.dir, 'et', now),
      intervalMs: ET_INTERVAL_MS,
      cap: DAILY_CAP,
    });
  }

  private async tickLive(): Promise<number> {
    const now = this.deps.now();
    const delay = this.schedule(now);
    if (delay === null) return RECHECK_MS;
    if (delay > 0) return delay;

    // Counted before the request: a failed call still consumes PRIM quota.
    recordCall(this.deps.dir, 'et', now);
    this.lastAttempt = now;
    try {
      const { journeys } = parseEstimatedTimetable(await this.deps.fetchEt());
      const runs = buildRuns(journeys, getNetwork(), this.current?.runs ?? null, now);
      saveSnapshot(this.deps.dir, { fetchedAt: now, journeys, runs });
      this.current = { fetchedAt: now, source: 'live', runs };
      this.lastFetch = now;
      this.failures = 0;
    } catch (e) {
      this.failures += 1;
      console.error(`[poller] estimated-timetable failed (failures=${this.failures})`, e);
    }
    return this.schedule(now) ?? RECHECK_MS;
  }

  /** Disruptions step: same window and daily cap as the timetable, every 5 min; a failure never affects the snapshot. */
  private async tickDisruptions(): Promise<number> {
    const now = this.deps.now();
    const next = () =>
      nextDelayMs(now, {
        lastFetch: this.disruptionsAttempt,
        failures: this.disruptionsFailures,
        callsToday: callsToday(this.deps.dir, 'disruptions', now),
        intervalMs: DISRUPTIONS_INTERVAL_MS,
        cap: DAILY_CAP,
      });
    const delay = next();
    if (delay === null) return RECHECK_MS;
    if (delay > 0) return delay;

    recordCall(this.deps.dir, 'disruptions', now);
    this.disruptionsAttempt = now;
    try {
      const disruptions = parseDisruptions(await this.deps.fetchDisruptions(), now);
      saveDisruptions(this.deps.dir, { fetchedAt: now, disruptions });
      this.cachedDisruptions = disruptions;
      this.disruptionsFailures = 0;
    } catch (e) {
      this.disruptionsFailures += 1;
      console.error(`[poller] disruptions failed (failures=${this.disruptionsFailures})`, e);
    }
    return next() ?? RECHECK_MS;
  }

  private tickReplay(): number {
    const now = this.deps.now();
    if (!this.replayDisruptions) {
      // Evaluated at the fixture's capture time so that its periods are active whenever the replay runs.
      try {
        const raw = JSON.parse(readFileSync(path.join(process.cwd(), 'tests/fixtures/disruptions-sample.json'), 'utf8'));
        this.replayDisruptions = parseDisruptions(raw, Date.parse(raw.lastUpdatedDate));
      } catch {
        this.replayDisruptions = []; // timetable replay must still work without disruptions
      }
      this.cachedDisruptions = this.replayDisruptions;
    }
    if (!this.replayJourneys) {
      // Read once; every time is shifted once, at startup, so that the fixture's response time is "now".
      const raw = JSON.parse(readFileSync(path.join(process.cwd(), 'tests/fixtures/et-sample.json'), 'utf8'));
      const { responseTime, journeys } = parseEstimatedTimetable(raw);
      this.replayJourneys = shift(journeys, now - responseTime);
    }
    if (this.lastFetch === null || now - this.lastFetch >= ET_INTERVAL_MS) {
      const runs = buildRuns(this.replayJourneys, getNetwork(), this.current?.runs ?? null, now);
      this.current = { fetchedAt: now, source: 'replay', runs };
      this.lastFetch = now;
    }
    return Math.max(0, this.lastFetch + ET_INTERVAL_MS - now);
  }
}

declare global {
  var __ltpPoller: Poller | undefined;
}

/** Process-wide poller, kept on globalThis so hot reloads reuse it. */
export function getPoller(): Poller {
  globalThis.__ltpPoller ??= new Poller();
  return globalThis.__ltpPoller;
}
