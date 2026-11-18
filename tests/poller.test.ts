import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { defaultCacheDir, getPoller, Poller } from '@/lib/realtime/poller';
import { PrimError } from '@/lib/realtime/prim-client';
import { loadBudget, loadDisruptions, loadSnapshot, recordCall, saveSnapshot } from '@/lib/realtime/store';
import type { VehicleRun } from '@/lib/types';

const S = 1000;
const T0 = Date.parse('2026-11-16T10:00:00Z'); // 11:00 Paris, en service

const emptyEt = (ts: number) => ({
  Siri: { ServiceDelivery: { ResponseTimestamp: new Date(ts).toISOString(), EstimatedTimetableDelivery: [{ EstimatedJourneyVersionFrame: [] }] } },
});

const oldRun: VehicleRun = {
  id: 'old', lineId: 'C01371', direction: 'Aller', destination: 'X', hasPrevious: false, prevInferred: false,
  stops: [{ quay: 'A', arr: T0, dep: T0 + 20 * S }],
};

let dir: string;
let clock: number;
let calls: number;
const now = () => clock;
const okDisruptions = async () => ({ disruptions: [], lines: [] });
const okFetch = async () => {
  calls++;
  return emptyEt(clock);
};

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'ltp-poller-'));
  clock = T0;
  calls = 0;
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe('store', () => {
  it('remet le budget à zéro au changement de jour Paris', () => {
    recordCall(dir, 'et', Date.parse('2026-11-16T22:58:00Z')); // 23:58 Paris
    recordCall(dir, 'et', Date.parse('2026-11-16T22:59:00Z'));
    expect(loadBudget(dir)).toEqual({ day: '2026-11-16', calls: { et: 2, disruptions: 0 } });
    recordCall(dir, 'et', Date.parse('2026-11-16T23:01:00Z')); // 00:01 Paris le 17
    expect(loadBudget(dir)).toEqual({ day: '2026-11-17', calls: { et: 1, disruptions: 0 } });
  });

  it('écrit de façon atomique sans laisser de fichier temporaire', () => {
    saveSnapshot(dir, { fetchedAt: T0, journeys: [], runs: [oldRun] });
    expect(loadSnapshot(dir)).toEqual({ fetchedAt: T0, journeys: [], runs: [oldRun] });
    expect(readdirSync(dir).sort()).toEqual(['snapshot.json']);
  });

  it('dossier vide : budget nul et pas de snapshot', () => {
    expect(loadBudget(dir).calls).toEqual({ et: 0, disruptions: 0 });
    expect(loadSnapshot(dir)).toBeNull();
  });
});

describe('Poller (live)', () => {
  it('redémarrage avec un snapshot de 30 s : aucun appel, snapshot servi depuis le cache', async () => {
    saveSnapshot(dir, { fetchedAt: T0 - 30 * S, journeys: [], runs: [oldRun] });
    const p = new Poller({ now, fetchEt: okFetch, fetchDisruptions: okDisruptions, dir, live: true });
    const delay = await p.tick();
    expect(calls).toBe(0);
    expect(delay).toBe(70_000);
    const snap = p.snapshot();
    expect(snap).not.toBeNull();
    expect(snap!.source).toBe('cache');
    expect(snap!.runs).toEqual([oldRun]);
    expect(p.status()).toMatchObject({ mode: 'live', lastFetch: T0 - 30 * S, callsToday: 0, failures: 0 });
  });

  it('cumule callsToday entre deux pollers successifs sur le même dossier', async () => {
    const p1 = new Poller({ now, fetchEt: okFetch, fetchDisruptions: okDisruptions, dir, live: true });
    expect(await p1.tick()).toBe(100_000);
    expect(calls).toBe(1);
    expect(p1.status().callsToday).toBe(1);
    expect(p1.snapshot()!.source).toBe('live');

    clock += 100 * S;
    const p2 = new Poller({ now, fetchEt: okFetch, fetchDisruptions: okDisruptions, dir, live: true });
    expect(p2.snapshot()!.source).toBe('cache');
    await p2.tick();
    expect(calls).toBe(2);
    expect(p2.status().callsToday).toBe(2);
    expect(loadBudget(dir).calls.et).toBe(2);
  });

  it('429 : failures 1, ancien snapshot conservé, prochain délai 200 s', async () => {
    saveSnapshot(dir, { fetchedAt: T0 - 150 * S, journeys: [], runs: [oldRun] });
    const fetchEt = async () => {
      calls++;
      throw new PrimError(429);
    };
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const p = new Poller({ now, fetchEt, fetchDisruptions: okDisruptions, dir, live: true });
    const delay = await p.tick();
    expect(log).toHaveBeenCalledOnce();
    expect(calls).toBe(1);
    expect(delay).toBe(200_000);
    expect(p.status()).toMatchObject({ failures: 1, callsToday: 1, lastFetch: T0 - 150 * S });
    expect(p.snapshot()!.runs).toEqual([oldRun]);
    expect(loadSnapshot(dir)!.fetchedAt).toBe(T0 - 150 * S);
  });

  it('plafond atteint : aucun appel, revérifie dans 5 min', async () => {
    for (let i = 0; i < 900; i++) recordCall(dir, 'et', T0);
    const p = new Poller({ now, fetchEt: okFetch, fetchDisruptions: okDisruptions, dir, live: true });
    expect(await p.tick()).toBe(5 * 60_000);
    expect(calls).toBe(0);
  });

  it('hors fenêtre de service : aucun appel', async () => {
    clock = Date.parse('2026-11-16T02:00:00Z'); // 03:00 Paris
    const p = new Poller({ now, fetchEt: okFetch, fetchDisruptions: okDisruptions, dir, live: true });
    expect(await p.tick()).toBe(5 * 60_000);
    expect(calls).toBe(0);
  });
});

describe('Poller (replay)', () => {
  it('rejoue la fixture décalée à maintenant sans appel réseau', async () => {
    const fetchDisruptions = async () => {
      calls++;
      return {};
    };
    const p = new Poller({ now, fetchEt: okFetch, fetchDisruptions, dir, live: false });
    expect(await p.tick()).toBe(100_000);
    expect(calls).toBe(0);
    const snap = p.snapshot()!;
    expect(snap.source).toBe('replay');
    expect(snap.runs.length).toBeGreaterThan(0);
    expect(snap.runs.some((r) => r.stops[1] && r.stops[1].arr !== null && r.stops[1].arr > clock)).toBe(true);
    expect(p.status().mode).toBe('replay');

    // 100 s plus tard : reconstruction avec le même décalage, toujours sans appel.
    clock += 100 * S;
    await p.tick();
    expect(calls).toBe(0);
    expect(p.snapshot()!.fetchedAt).toBe(clock);
    expect(loadBudget(dir).calls).toEqual({ et: 0, disruptions: 0 });
  });
});

describe('Poller.start / getPoller (contrat utilisé par les routes de la tâche 6)', () => {
  afterEach(() => {
    vi.useRealTimers();
    delete globalThis.__ltpPoller;
  });

  it('start() est idempotent : un seul appel PRIM même si appelé plusieurs fois', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const p = new Poller({ now, fetchEt: okFetch, fetchDisruptions: okDisruptions, dir, live: true });
    p.start();
    p.start();
    p.start();
    await vi.waitFor(() => expect(p.snapshot()?.source).toBe('live'));
    expect(calls).toBe(1);
    expect(loadBudget(dir).calls.et).toBe(1);
    // Une seule boucle de polling programmée (pas une par appel à start()).
    await vi.waitFor(() => expect(vi.getTimerCount()).toBe(1));
    await new Promise((r) => setImmediate(r));
    expect(vi.getTimerCount()).toBe(1);
  });

  it('getPoller() renvoie toujours la même instance (globalThis)', () => {
    delete globalThis.__ltpPoller;
    const a = getPoller();
    expect(getPoller()).toBe(a);
    expect(globalThis.__ltpPoller).toBe(a);
  });
});

describe('Poller (perturbations)', () => {
  const disr = {
    disruptions: [{ id: 'd1', applicationPeriods: [{ begin: '20261116T000000', end: '20261116T235959' }], severity: 'BLOQUANTE', title: 'T', message: 'm' }],
    lines: [{ id: 'line:IDFM:C01371', impactedObjects: [{ type: 'line', id: 'x', disruptionIds: ['d1'] }] }],
  };

  it('live : un appel perturbations, persisté et compté, puis pas de nouvel appel avant 5 min', async () => {
    let n = 0;
    const fetchDisruptions = async () => {
      n++;
      return disr;
    };
    const p = new Poller({ now, fetchEt: okFetch, fetchDisruptions, dir, live: true });
    await p.tick();
    expect(n).toBe(1);
    expect(p.disruptions().map((d) => d.id)).toEqual(['d1']);
    expect(loadBudget(dir).calls).toEqual({ et: 1, disruptions: 1 });
    expect(loadDisruptions(dir)!.disruptions).toHaveLength(1);

    clock += 100 * S;
    await p.tick();
    expect(n).toBe(1);
    clock += 200 * S;
    await p.tick();
    expect(n).toBe(2);

    // Redémarrage : perturbations rechargées depuis le disque sans nouvel appel.
    const p2 = new Poller({ now, fetchEt: okFetch, fetchDisruptions, dir, live: true });
    await p2.tick();
    expect(n).toBe(2);
    expect(p2.disruptions()).toHaveLength(1);
  });

  it('live : les périodes terminées depuis le dernier appel sont retirées', async () => {
    const p = new Poller({ now, fetchEt: okFetch, fetchDisruptions: async () => disr, dir, live: true });
    await p.tick();
    expect(p.disruptions()).toHaveLength(1);
    clock = Date.parse('2026-11-16T23:30:00Z'); // 00:30 Paris le 17
    expect(p.disruptions()).toEqual([]);
  });

  it('échec perturbations : le snapshot du timetable est conservé, failures du timetable inchangé', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchDisruptions = async () => {
      throw new PrimError(429);
    };
    const p = new Poller({ now, fetchEt: okFetch, fetchDisruptions, dir, live: true });
    await p.tick();
    expect(log).toHaveBeenCalledOnce();
    expect(p.snapshot()!.source).toBe('live');
    expect(p.status().failures).toBe(0);
    expect(loadBudget(dir).calls.disruptions).toBe(1);
  });

  it('replay : perturbations de la fixture sans aucun appel', async () => {
    const p = new Poller({ now, fetchEt: okFetch, fetchDisruptions: async () => { calls++; return {}; }, dir, live: false });
    await p.tick();
    expect(calls).toBe(0);
    expect(p.disruptions().length).toBeGreaterThan(0);
  });
});

describe('Poller.refresh (hébergement serverless)', () => {
  it('appelle PRIM à la demande quand les données sont dues, sans boucle de fond', async () => {
    const p = new Poller({ now, fetchEt: okFetch, fetchDisruptions: okDisruptions, dir, live: true });
    expect(p.snapshot()).toBeNull();
    await p.refresh();
    expect(calls).toBe(1);
    expect(p.snapshot()?.source).toBe('live');
    clock += 10 * S; // pas encore dû
    await p.refresh();
    expect(calls).toBe(1);
    clock += 100 * S;
    await p.refresh();
    expect(calls).toBe(2);
  });

  it('partage un même appel entre requêtes simultanées', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slowFetch = async () => {
      calls++;
      await gate;
      return emptyEt(clock);
    };
    const p = new Poller({ now, fetchEt: slowFetch, fetchDisruptions: okDisruptions, dir, live: true });
    const a = p.refresh();
    const b = p.refresh();
    release();
    await Promise.all([a, b]);
    expect(calls).toBe(1);
  });

  it('garde son cache dans le dossier temporaire sur Vercel (fichiers du projet en lecture seule)', () => {
    expect(defaultCacheDir({ VERCEL: '1' } as unknown as NodeJS.ProcessEnv)).toBe(path.join(tmpdir(), 'ltp-cache'));
    expect(defaultCacheDir({} as unknown as NodeJS.ProcessEnv)).toBe(path.join(process.cwd(), '.cache'));
  });
});
