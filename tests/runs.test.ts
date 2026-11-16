import { describe, expect, it } from 'vitest';
import { buildRuns } from '@/lib/realtime/runs';
import type { Journey, Network, VehicleRun } from '@/lib/types';

const L = 'C01371';
const T = Date.parse('2026-11-16T10:00:00.000Z');
const S = 1000;
const M = 60 * S;

function miniNetwork(): Network {
  const quay = (id: string, i: number) => ({ id, name: id, lon: 2.3 + i * 0.01, lat: 48.85, stationId: `S${i + 1}` });
  const seg = (a: number, b: number) => ({ coords: [[2.3 + a * 0.01, 48.85], [2.3 + b * 0.01, 48.85]] as [number, number][], seconds: 60 });
  return {
    generatedAt: '2026-11-16',
    lines: {},
    quays: { A: quay('A', 0), B: quay('B', 1), C: quay('C', 2), D: quay('D', 3) },
    stations: {},
    patterns: [{ lineId: L, directionId: 0, quays: ['A', 'B', 'C', 'D'], trips: 100, headsign: 'D' }],
    segments: { 'A>B': seg(0, 1), 'B>C': seg(1, 2), 'C>D': seg(2, 3) },
  };
}

const journey = (ref: string, calls: [string, number][], over: Partial<Journey> = {}): Journey => ({
  ref,
  lineId: L,
  direction: 'Aller',
  destination: 'D',
  operator: 'RATP',
  calls: calls.map(([quay, t]) => ({ quay, arr: t, dep: t + 20 * S })),
  ...over,
});

describe('buildRuns', () => {
  const net = miniNetwork();

  it('sans instantané précédent, infère la station précédente depuis le pattern', () => {
    const tB = T + 30 * S;
    const runs = buildRuns([journey('r1', [['B', tB], ['C', T + 90 * S]])], net, null, T);
    expect(runs).toHaveLength(1);
    const r = runs[0];
    expect(r.id).toBe('r1');
    expect(r.hasPrevious).toBe(true);
    expect(r.prevInferred).toBe(true);
    expect(r.stops[0].quay).toBe('A');
    expect(r.stops[0].dep).toBe(tB - 60000);
    expect(r.stops.map((s) => s.quay)).toEqual(['A', 'B', 'C']);
  });

  it("apparie à l'instantané précédent et reprend l'arrêt disparu avec ses heures", () => {
    const prevA = { quay: 'A', arr: T - 50 * S, dep: T - 30 * S };
    const previous: VehicleRun[] = [
      {
        id: 'old-id', lineId: L, direction: 'Aller', destination: 'D', hasPrevious: false, prevInferred: false,
        stops: [prevA, { quay: 'B', arr: T + 30 * S, dep: T + 50 * S }, { quay: 'C', arr: T + 90 * S, dep: T + 110 * S }],
      },
    ];
    const runs = buildRuns([journey('new-ref', [['B', T + 70 * S], ['C', T + 130 * S]])], net, previous, T + 60 * S);
    expect(runs).toHaveLength(1);
    expect(runs[0].id).toBe('old-id');
    expect(runs[0].stops[0]).toEqual(prevA);
    expect(runs[0].hasPrevious).toBe(true);
    expect(runs[0].prevInferred).toBe(false);
  });

  it('SNCF : apparie par ref', () => {
    const previous: VehicleRun[] = [
      {
        id: 'SNCF:1', lineId: L, direction: 'Aller', destination: 'D', hasPrevious: false, prevInferred: false,
        stops: [{ quay: 'A', arr: T - 50 * S, dep: T - 30 * S }, { quay: 'B', arr: T + 30 * S, dep: T + 50 * S }],
      },
    ];
    const j = journey('SNCF:1', [['B', T + 10 * M]], { operator: 'SNCF' });
    const runs = buildRuns([j], net, previous, T);
    expect(runs[0].id).toBe('SNCF:1');
    expect(runs[0].stops[0].quay).toBe('A');
    expect(runs[0].prevInferred).toBe(false);
  });

  it('rame au terminus de départ : pas de station précédente, conservée même > 30 min', () => {
    const r1 = buildRuns([journey('t1', [['A', T + 5 * M], ['B', T + 7 * M]])], net, null, T);
    expect(r1).toHaveLength(1);
    expect(r1[0].hasPrevious).toBe(false);
    expect(r1[0].prevInferred).toBe(false);
    expect(r1[0].stops.map((s) => s.quay)).toEqual(['A', 'B']);
    const r2 = buildRuns([journey('t2', [['A', T + 45 * M], ['B', T + 47 * M]])], net, null, T);
    expect(r2).toHaveLength(1);
  });

  it('écarte les rames dont tous les arrêts sont à plus de 30 min hors terminus', () => {
    const runs = buildRuns([journey('far', [['C', T + 31 * M], ['D', T + 33 * M]])], net, null, T);
    expect(runs).toEqual([]);
  });

  it('écarte un journey dont le premier quai est inconnu', () => {
    const runs = buildRuns([journey('z', [['ZZZ', T + 30 * S], ['B', T + 90 * S]])], net, null, T);
    expect(runs).toEqual([]);
  });

  it('écarte un journey dont le segment précédent→premier quai est inconnu', () => {
    const n2 = miniNetwork();
    delete n2.segments['B>C'];
    expect(buildRuns([journey('x', [['C', T + 30 * S], ['D', T + 90 * S]])], n2, null, T)).toEqual([]);
  });

  it("un run précédent n'est hérité que par un seul journey", () => {
    const previous: VehicleRun[] = [
      {
        id: 'old-id', lineId: L, direction: 'Aller', destination: 'D', hasPrevious: false, prevInferred: false,
        stops: [{ quay: 'A', arr: T - 50 * S, dep: T - 30 * S }, { quay: 'B', arr: T + 30 * S, dep: T + 50 * S }, { quay: 'C', arr: T + 90 * S, dep: T + 110 * S }],
      },
    ];
    const runs = buildRuns(
      [journey('j1', [['B', T + 60 * S], ['C', T + 120 * S]]), journey('j2', [['B', T + 40 * S], ['C', T + 100 * S]])],
      net,
      previous,
      T,
    );
    expect(runs).toHaveLength(2);
    expect(runs.filter((r) => r.id === 'old-id')).toHaveLength(1);
    // le plus proche en temps (j2, 10 s d'écart) hérite ; l'autre garde sa ref
    expect(runs.find((r) => r.id === 'old-id')!.stops[1].arr).toBe(T + 40 * S);
    expect(runs.map((r) => r.id).sort()).toEqual(['j1', 'old-id']);
  });

  it("n'apparie pas au-delà de 120 s ni sur une autre destination", () => {
    const previous: VehicleRun[] = [
      {
        id: 'old-id', lineId: L, direction: 'Aller', destination: 'D', hasPrevious: false, prevInferred: false,
        stops: [{ quay: 'A', arr: T - 50 * S, dep: T - 30 * S }, { quay: 'B', arr: T + 30 * S, dep: T + 50 * S }],
      },
    ];
    const late = buildRuns([journey('j1', [['B', T + 151 * S]])], net, previous, T);
    expect(late[0].id).toBe('j1');
    expect(late[0].prevInferred).toBe(true);
    const other = buildRuns([journey('j2', [['B', T + 30 * S]], { destination: 'Autre' })], net, previous, T);
    expect(other[0].id).toBe('j2');
  });

  it('ref vide → id composite', () => {
    const runs = buildRuns([journey('', [['B', T + 30 * S]])], net, null, T);
    expect(runs[0].id).toBe(`${L}:Aller:B:${T + 30 * S}`);
  });
});
