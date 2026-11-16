import { describe, expect, it } from 'vitest';
import type { Disruption, Network, VehicleRun } from '../lib/types';
import {
  correspondences,
  directionLabel,
  lineBounds,
  lineBranches,
  lineStatus,
  nextArrivalsAlongBranch,
} from '../lib/client/lineFocus';

const L = 'L1';
const mkNet = (): Network => {
  const quays: Network['quays'] = {};
  const stations: Network['stations'] = {};
  for (let n = 1; n <= 5; n++) {
    quays[`q${n}`] = { id: `q${n}`, name: `S${n}`, lon: n, lat: 48, stationId: `S${n}` };
    quays[`q${n}b`] = { id: `q${n}b`, name: `S${n}`, lon: n, lat: 48.001, stationId: `S${n}` };
    stations[`S${n}`] = { id: `S${n}`, name: `S${n}`, lon: n, lat: 48, quays: [`q${n}`, `q${n}b`], lines: [L] };
  }
  const segments: Network['segments'] = {};
  const seg = (a: string, b: string) => {
    segments[`${a}>${b}`] = { coords: [[quays[a].lon, quays[a].lat], [quays[b].lon, quays[b].lat]], seconds: 60 };
  };
  seg('q1', 'q2'); seg('q2', 'q3'); seg('q3', 'q4'); seg('q3', 'q5');
  seg('q4b', 'q3b'); seg('q3b', 'q2b'); seg('q2b', 'q1b');
  const pat = (directionId: 0 | 1, qs: string[], trips: number) => ({ lineId: L, directionId, quays: qs, trips, headsign: '' });
  return {
    generatedAt: '', lines: { [L]: { id: L, shortName: '1', mode: 'metro', color: '#fc0', textColor: '#000', longName: 'Ligne 1', shapes: [[[2, 48], [2.5, 48.9]]] } },
    quays, stations,
    patterns: [
      pat(0, ['q1', 'q2', 'q3', 'q4'], 90), pat(0, ['q1', 'q2', 'q3', 'q5'], 30), pat(0, ['q1', 'q2'], 3),
      pat(1, ['q4b', 'q3b', 'q2b', 'q1b'], 100),
    ],
    segments,
  };
};

const run = (id: string, stops: [string, number | null, number | null][], extra: Partial<VehicleRun> = {}): VehicleRun => ({
  id, lineId: L, direction: '', destination: '', hasPrevious: false, prevInferred: false,
  stops: stops.map(([quay, arr, dep]) => ({ quay, arr, dep })), ...extra,
});

const t = 1_000_000_000;
const net = mkNet();

describe('lineBranches', () => {
  const branches = lineBranches(net, L);
  it('groups by terminus with the 5% rule', () => {
    expect(branches.map((b) => [b.directionId, b.terminusStationId, b.trips])).toEqual([
      [0, 'S4', 90], [0, 'S5', 30], [1, 'S1', 100],
    ]);
    expect(branches[1].stations).toEqual(['S1', 'S2', 'S3', 'S5']);
    expect(branches[0].terminusName).toBe('S4');
  });
  it('unknown line gives no branch', () => expect(lineBranches(net, 'zz')).toEqual([]));
  it('labels directions', () => {
    expect(directionLabel(branches, 0)).toBe('vers S4 / S5');
    expect(directionLabel(branches, 1)).toBe('vers S1');
  });
});

describe('nextArrivalsAlongBranch', () => {
  const b4 = lineBranches(net, L)[0];
  const A = run('A', [['q2', null, t + 60_000], ['q3', t + 120_000, t + 125_000], ['q4', t + 180_000, null]]);
  const B = run('B', [['q3b', t + 30_000, null], ['q2b', t + 90_000, null]]);
  it('computes times in the branch direction', () => {
    const r = nextArrivalsAlongBranch(b4, [A, B], net, t);
    expect(r.S3.seconds).toBe(120);
    expect(r.S4.seconds).toBe(180);
    expect(r.S2.seconds).toBe(60);
    expect(r.S1.seconds).toBeNull();
    expect(Object.keys(r).sort()).toEqual(['S1', 'S2', 'S3', 'S4']);
  });
  it('ignores inferred previous stop', () => {
    const r = nextArrivalsAlongBranch(b4, [run('C', [['q1', null, t + 10_000], ['q2', t + 70_000, t + 75_000], ['q3', t + 130_000, null]], { prevInferred: true, hasPrevious: true })], net, t);
    expect(r.S1.seconds).toBeNull();
    expect(r.S1.atPlatform).toBe(false);
    expect(r.S2.seconds).toBe(70);
  });
  it('flags atPlatform under 30 s', () => {
    const r = nextArrivalsAlongBranch(b4, [run('D', [['q2', t + 20_000, t + 40_000], ['q3', t + 100_000, null]])], net, t);
    expect(r.S2.atPlatform).toBe(true);
    expect(r.S3.atPlatform).toBe(false);
  });
  it('flags atPlatform for a dwelling train', () => {
    const r = nextArrivalsAlongBranch(b4, [run('E', [['q1', t - 100_000, t - 90_000], ['q2', t - 10_000, t + 20_000], ['q3', t + 80_000, null]])], net, t);
    expect(r.S2.atPlatform).toBe(true);
  });
  it('handles no runs', () => {
    const r = nextArrivalsAlongBranch(b4, [], net, t);
    for (const s of ['S1', 'S2', 'S3', 'S4']) expect(r[s]).toEqual({ seconds: null, atPlatform: false });
  });
  it('a train to S5 does not count for S4 but counts for S2 and S3', () => {
    const r = nextArrivalsAlongBranch(b4, [run('F', [['q2', null, t + 60_000], ['q3', t + 120_000, t + 130_000], ['q5', t + 200_000, null]])], net, t);
    expect(r.S4.seconds).toBeNull();
    expect(r.S2.seconds).toBe(60);
    expect(r.S3.seconds).toBe(120);
  });
  it('ignores a run coming from the next branch station and leaving to a sibling branch', () => {
    const r = nextArrivalsAlongBranch(b4, [run('H', [['q4', null, t + 10_000], ['q3', t + 60_000, t + 70_000], ['q5', t + 130_000, null]])], net, t);
    expect(r.S3.seconds).toBeNull();
  });
  it('computes arrivals for a direction 1 branch', () => {
    const b1 = lineBranches(net, L).find((b) => b.directionId === 1)!;
    const r = nextArrivalsAlongBranch(b1, [run('I', [['q3b', t + 30_000, t + 35_000], ['q2b', t + 90_000, t + 95_000], ['q1b', t + 150_000, null]])], net, t);
    expect(r.S3.seconds).toBe(30);
    expect(r.S2.seconds).toBe(90);
    expect(r.S1.seconds).toBe(150);
  });
  it('past times are ignored', () => {
    const r = nextArrivalsAlongBranch(b4, [run('G', [['q2', t - 60_000, t - 50_000], ['q3', t + 10_000, t + 20_000], ['q4', t + 80_000, null]])], net, t);
    expect(r.S2.seconds).toBeNull();
    expect(r.S3.seconds).toBe(10);
  });
});

describe('correspondences', () => {
  it('orders by mode then shortName', () => {
    const mk = (id: string, mode: 'metro' | 'rer' | 'tram' | 'transilien', shortName: string) => ({ id, shortName, mode, color: '', textColor: '', longName: '', shapes: [] });
    const n = { ...net, lines: {
      C01371: mk('C01371', 'metro', '1'), C01743: mk('C01743', 'rer', 'B'),
      C01390: mk('C01390', 'tram', 'T2'), C01739: mk('C01739', 'transilien', 'J'),
    }, stations: { X: { id: 'X', name: 'X', lon: 0, lat: 0, quays: [], lines: ['C01371', 'C01743', 'C01390', 'C01739'] } } };
    expect(correspondences(n, 'X', 'C01371')).toEqual(['C01743', 'C01390', 'C01739']);
    expect(correspondences(n, 'nope', 'C01371')).toEqual([]);
  });
  it('sorts shortNames naturally', () => {
    const mk = (id: string, shortName: string) => ({ id, shortName, mode: 'metro' as const, color: '', textColor: '', longName: '', shapes: [] });
    const n = { ...net, lines: { a: mk('a', '10'), b: mk('b', '2'), c: mk('c', '1') },
      stations: { X: { id: 'X', name: 'X', lon: 0, lat: 0, quays: [], lines: ['a', 'b', 'c'] } } };
    expect(correspondences(n, 'X', 'c')).toEqual(['b', 'a']);
  });
});

describe('lineStatus', () => {
  const d = (begin: number, end: number): Disruption => ({ id: 'd', lineIds: [L], title: '', message: '', severity: '', periods: [{ begin, end }] });
  it('disrupted wins', () => expect(lineStatus(L, [d(t - 1, t + 1)], [], t)).toBe('disrupted'));
  it('expired + no run is no-service', () => expect(lineStatus(L, [d(t - 10, t - 1)], [], t)).toBe('no-service'));
  it('ok with runs', () => expect(lineStatus(L, [], [run('A', [['q1', null, t]])], t)).toBe('ok'));
  it('other lines disruptions are ignored', () => expect(lineStatus('other', [d(t - 1, t + 1)], [], t)).toBe('no-service'));
});

describe('lineBounds', () => {
  it('computes bbox', () => expect(lineBounds(net, L)).toEqual([[2, 48], [2.5, 48.9]]));
  it('null for unknown or shapeless', () => {
    expect(lineBounds(net, 'zz')).toBeNull();
    expect(lineBounds({ ...net, lines: { [L]: { ...net.lines[L], shapes: [] } } }, L)).toBeNull();
  });
});
