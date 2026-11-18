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

  it('coupe un journey aux paires qui ne sont pas des segments (données RATP non contiguës)', () => {
    const tB = T + 30 * S;
    const tD = T + 60 * S;
    const runs = buildRuns([journey('r1', [['B', tB], ['D', tD]])], net, null, T);
    expect(runs.map((r) => r.id)).toEqual(['r1', 'r1#1']);
    // chaque morceau a une station précédente inférée et ne contient que des segments du réseau
    expect(runs[0].stops.map((s) => s.quay)).toEqual(['A', 'B']);
    expect(runs[1].stops.map((s) => s.quay)).toEqual(['C', 'D']);
    expect(runs.every((r) => r.hasPrevious && r.prevInferred)).toBe(true);
    expect(runs[1].stops[0].dep).toBe(tD - 60000);
    for (const r of runs) for (let i = 0; i + 1 < r.stops.length; i++) expect(net.segments[`${r.stops[i].quay}>${r.stops[i + 1].quay}`]).toBeDefined();
  });

  it('un morceau qui commence par un quai inconnu est écarté, le reste est gardé', () => {
    const runs = buildRuns([journey('r1', [['B', T + 30 * S], ['ZZZ', T + 60 * S]])], net, null, T);
    expect(runs).toHaveLength(1);
    expect(runs[0].stops.map((s) => s.quay)).toEqual(['A', 'B']);
  });

  it('ids des morceaux uniques avec une ref vide', () => {
    const runs = buildRuns([journey('', [['B', T + 30 * S], ['D', T + 60 * S]])], net, null, T);
    expect(runs.map((r) => r.id)).toEqual([`${L}:Aller:B:${T + 30 * S}`, `${L}:Aller:D:${T + 60 * S}`]);
  });

  it('terminus de départ : pas de station précédente inventée même si le quai est en milieu de pattern ailleurs', () => {
    const n2 = miniNetwork();
    // B est l'origine d'une mission partielle plus fréquente que la mission complète qui y passe
    n2.patterns = [
      { lineId: L, directionId: 0, quays: ['A', 'B', 'C', 'D'], trips: 10, headsign: 'D' },
      { lineId: L, directionId: 0, quays: ['B', 'C', 'D'], trips: 100, headsign: 'D' },
    ];
    const r = buildRuns([journey('t', [['B', T + 5 * M], ['C', T + 7 * M]])], n2, null, T);
    expect(r).toHaveLength(1);
    expect(r[0].hasPrevious).toBe(false);
    // missions passantes majoritaires : la station précédente est inférée
    n2.patterns[0].trips = 1000;
    const r2 = buildRuns([journey('t', [['B', T + 30 * S], ['C', T + 90 * S]])], n2, null, T);
    expect(r2[0].stops[0].quay).toBe('A');
    expect(r2[0].prevInferred).toBe(true);
  });

  it('morceau RATP (station précédente inférée + un arrêt) prolongeant une autre rame : fusionné', () => {
    const runs = buildRuns(
      [journey('j1', [['A', T - 40 * S], ['B', T + 30 * S]]), journey('j2', [['C', T + 30 * S + 20 * S + 60 * S]])],
      net,
      null,
      T,
    );
    expect(runs).toHaveLength(1);
    expect(runs[0].id).toBe('j1');
    expect(runs[0].stops.map((s) => s.quay)).toEqual(['A', 'B', 'C']);
  });

  it('morceau RATP doublon d’une rame qui passe déjà par la station inférée : jamais dessiné', () => {
    const runs = buildRuns(
      [journey('j1', [['A', T - 40 * S], ['B', T + 30 * S], ['C', T + 110 * S]]), journey('j2', [['C', T + 115 * S]])],
      net,
      null,
      T,
    );
    expect(runs).toHaveLength(2);
    expect(runs.find((r) => r.id === 'j2')!.hide).toBe('always');
    expect(runs.find((r) => r.id === 'j1')!.hide).toBeUndefined();
  });

  it("au terminus, seule la rame qui part la première est dessinée à l'attente", () => {
    const runs = buildRuns(
      [journey('t2', [['A', T + 5 * M], ['B', T + 7 * M]]), journey('t1', [['A', T + 2 * M], ['B', T + 4 * M]])],
      net,
      null,
      T,
    );
    expect(runs.find((r) => r.id === 't1')!.hide).toBeUndefined();
    expect(runs.find((r) => r.id === 't2')!.hide).toBe('whileWaiting');
  });

  it("n'hérite pas d'une station précédente encore à venir (autre morceau d'un journey RATP)", () => {
    const previous: VehicleRun[] = [
      {
        id: 'old', lineId: L, direction: 'Aller', destination: 'D', hasPrevious: false, prevInferred: false,
        stops: [{ quay: 'A', arr: null, dep: T + 2 * M }, { quay: 'B', arr: T + 3 * M, dep: T + 3 * M }, { quay: 'C', arr: T + 4 * M, dep: T + 4 * M }],
      },
    ];
    const runs = buildRuns([journey('n', [['C', T + 4 * M]])], net, previous, T);
    // C est apparié à « old » (index 2), mais B est encore à venir : on infère au lieu d'hériter
    expect(runs[0].prevInferred).toBe(true);
    expect(runs[0].stops[0].dep).toBe(T + 4 * M - 60_000);
  });

  it('ref vide → id composite', () => {
    const runs = buildRuns([journey('', [['B', T + 30 * S]])], net, null, T);
    expect(runs[0].id).toBe(`${L}:Aller:B:${T + 30 * S}`);
  });
});

describe('buildRuns delaySec', () => {
  const net = miniNetwork();
  it('recopie delaySec sur les stops, stop précédent inféré → null', () => {
    const j = journey('d1', [['B', T + 30 * S], ['C', T + 90 * S]]);
    j.calls[0].delaySec = 125;
    j.calls[1].delaySec = null;
    const r = buildRuns([j], net, null, T)[0];
    expect(r.stops.map((s) => s.delaySec)).toEqual([null, 125, null]);
  });
  it('stop précédent hérité garde son delaySec', () => {
    const previous: VehicleRun[] = [
      {
        id: 'old', lineId: L, direction: 'Aller', destination: 'D', hasPrevious: false, prevInferred: false,
        stops: [
          { quay: 'A', arr: T - 50 * S, dep: T - 30 * S, delaySec: 42 },
          { quay: 'B', arr: T + 30 * S, dep: T + 50 * S, delaySec: 0 },
          { quay: 'C', arr: T + 90 * S, dep: T + 110 * S, delaySec: 0 },
        ],
      },
    ];
    const j = journey('n', [['B', T + 70 * S], ['C', T + 130 * S]]);
    j.calls[0].delaySec = 10;
    const r = buildRuns([j], net, previous, T + 60 * S)[0];
    expect(r.stops[0].delaySec).toBe(42);
    expect(r.stops[1].delaySec).toBe(10);
  });
});

describe('buildRuns mission, numéro, longueur', () => {
  const net = miniNetwork();
  it('recopie les champs sur la course', () => {
    const [r] = buildRuns([journey('SNCF_1', [['A', T + 60 * S], ['B', T + 120 * S]], { operator: 'SNCF', mission: 'QIWI', trainNumber: 'QIWI60', length: 'long' })], net, null, T);
    expect([r.mission, r.trainNumber, r.length]).toEqual(['QIWI', 'QIWI60', 'long']);
  });
  it('course sans champs → null', () => {
    const [r] = buildRuns([journey('j1', [['A', T + 60 * S], ['B', T + 120 * S]])], net, null, T);
    expect([r.mission, r.trainNumber, r.length]).toEqual([null, null, null]);
  });
  it('fusion de doublons : les champs d\u2019un seul des deux sont conservés', () => {
    const calls1: [string, number][] = [['A', T - 40 * S], ['B', T + 30 * S]];
    const calls2: [string, number][] = [['C', T + 110 * S]];
    for (const [a, b] of [
      [{ mission: 'QIWI', trainNumber: 'QIWI60', length: 'long' as const }, {}],
      [{}, { mission: 'QIWI', trainNumber: 'QIWI60', length: 'long' as const }],
    ]) {
      const runs = buildRuns([journey('j1', calls1, a), journey('j2', calls2, b)], net, null, T);
      expect(runs).toHaveLength(1);
      expect([runs[0].mission, runs[0].trainNumber, runs[0].length]).toEqual(['QIWI', 'QIWI60', 'long']);
    }
  });
});
