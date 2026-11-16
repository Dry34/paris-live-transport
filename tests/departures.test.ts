import { describe, expect, it } from 'vitest';
import { departuresForStation } from '@/lib/realtime/departures';
import type { Network, Snapshot, VehicleRun } from '@/lib/types';

const T = Date.parse('2026-11-16T10:00:00.000Z');
const M = 60_000;

const net: Network = {
  generatedAt: '2026-11-16',
  lines: {},
  quays: {
    A: { id: 'A', name: 'A', lon: 2.3, lat: 48.85, stationId: 'S1' },
    B: { id: 'B', name: 'B', lon: 2.31, lat: 48.85, stationId: 'S2' },
    C: { id: 'C', name: 'C', lon: 2.32, lat: 48.85, stationId: 'S3' },
  },
  stations: {
    S1: { id: 'S1', name: 'S1', lon: 2.3, lat: 48.85, quays: ['A'], lines: ['C01371'] },
    S2: { id: 'S2', name: 'S2', lon: 2.31, lat: 48.85, quays: ['B'], lines: ['C01371'] },
    S3: { id: 'S3', name: 'S3', lon: 2.32, lat: 48.85, quays: ['C'], lines: ['C01371'] },
  },
  patterns: [],
  segments: {},
};

const run = (id: string, tB: number): VehicleRun => ({
  id, lineId: 'C01371', direction: 'Aller', destination: 'C', hasPrevious: true, prevInferred: false,
  stops: [
    { quay: 'A', arr: tB - 2 * M, dep: tB - M },
    { quay: 'B', arr: tB, dep: tB + 20_000 },
    { quay: 'C', arr: tB + 2 * M, dep: null },
  ],
});

describe('departuresForStation', () => {
  it('liste les prochains passages triés, exclut le passé', () => {
    const snap: Snapshot = { fetchedAt: T, source: 'replay', runs: [run('r5', T + 5 * M), run('rpast', T - M), run('r1', T + M)] };
    const out = departuresForStation(snap, net, 'S2', T);
    expect(Object.keys(out)).toEqual(['C01371|Aller']);
    expect(out['C01371|Aller']).toEqual([
      { lineId: 'C01371', destination: 'C', direction: 'Aller', time: T + M + 20_000, runId: 'r1' },
      { lineId: 'C01371', destination: 'C', direction: 'Aller', time: T + 5 * M + 20_000, runId: 'r5' },
    ]);
  });

  it("ignore stops[0] d'une rame avec station précédente (quittée ou inférée)", () => {
    const r: VehicleRun = { ...run('inf', T + 5 * M), prevInferred: true };
    r.stops[0] = { quay: 'A', arr: null, dep: T + 4 * M };
    const out = departuresForStation({ fetchedAt: T, source: 'replay', runs: [r] }, net, 'S1', T);
    expect(out).toEqual({});
    // sans station précédente, le premier arrêt est un vrai départ
    const t: VehicleRun = { ...r, hasPrevious: false, prevInferred: false };
    expect(departuresForStation({ fetchedAt: T, source: 'replay', runs: [t] }, net, 'S1', T)['C01371|Aller']).toHaveLength(1);
  });

  it("ignore l'arrivée au terminus (dernier arrêt sans départ), garde un dernier arrêt avec départ", () => {
    const r = run('r', T + M); // C : dep null
    expect(departuresForStation({ fetchedAt: T, source: 'replay', runs: [r] }, net, 'S3', T)).toEqual({});
    const withDep: VehicleRun = { ...r, stops: [...r.stops.slice(0, 2), { quay: 'C', arr: T + 3 * M, dep: T + 3 * M }] };
    expect(departuresForStation({ fetchedAt: T, source: 'replay', runs: [withDep] }, net, 'S3', T)['C01371|Aller']).toHaveLength(1);
  });

  it('fusionne deux passages à moins de 30 s sur la même ligne et direction', () => {
    const runs = [run('a', T + M), run('b', T + M + 29_000), run('c', T + M + 30_000 + 29_000)];
    const out = departuresForStation({ fetchedAt: T, source: 'replay', runs }, net, 'S2', T);
    expect(out['C01371|Aller'].map((d) => d.runId)).toEqual(['a', 'c']);
  });

  it('limite le nombre par clé et renvoie {} pour une station inconnue', () => {
    const runs = [1, 2, 3, 4, 5, 6].map((i) => run(`r${i}`, T + i * M));
    const out = departuresForStation({ fetchedAt: T, source: 'replay', runs }, net, 'S2', T);
    expect(out['C01371|Aller'].map((d) => d.runId)).toEqual(['r1', 'r2', 'r3', 'r4']);
    expect(departuresForStation({ fetchedAt: T, source: 'replay', runs }, net, 'S2', T, 2)['C01371|Aller']).toHaveLength(2);
    expect(departuresForStation({ fetchedAt: T, source: 'replay', runs }, net, 'NOPE', T)).toEqual({});
  });
});
