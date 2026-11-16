import { describe, it, expect } from 'vitest';
import type { Network, Pattern, VehicleRun } from '../lib/types';
import { createDiagramSmoother, diagramBranches, placeRunsOnDiagram } from '../lib/client/lineDiagram';
import { lineSlug, resolveLineId } from '../lib/lineSlug';

const quay = (id: string, lat: number) => ({ id, name: id, lon: 0, lat, stationId: `S${id}` });
const mkNet = (patterns: Pattern[]): Network =>
  ({
    lines: {
      C1: { id: 'C1', shortName: '1', mode: 'metro' },
      C2: { id: 'C2', shortName: 'B', mode: 'rer' },
      C3: { id: 'C3', shortName: 'T3a', mode: 'tram' },
      C4: { id: 'C4', shortName: 'J', mode: 'transilien' },
      C5: { id: 'C5', shortName: '7B', mode: 'metro' },
    },
    quays: { a: quay('a', 0), b: quay('b', 0.01), c: quay('c', 0.02), d: quay('d', 0.03), e: quay('e', 0.015), b2: { ...quay('b2', 0.01), stationId: 'Sb' } },
    patterns,
    segments: { 'b>c': { coords: [[0, 0.01], [0, 0.02]], seconds: 60 } },
  }) as unknown as Network;
const pat = (quays: string[], trips: number, directionId: 0 | 1 = 0, lineId = 'C1'): Pattern => ({ lineId, directionId, quays, trips, headsign: quays[quays.length - 1] });

describe('diagramBranches', () => {
  it('keeps one branch when a pattern is a subsequence of a more frequent one', () => {
    const net = mkNet([pat(['a', 'b', 'c'], 30), pat(['a', 'b', 'c', 'd'], 100)]);
    const br = diagramBranches(net, 'C1');
    expect(br).toHaveLength(1);
    expect(br[0].stations).toEqual(['Sa', 'Sb', 'Sc', 'Sd']);
    expect(br[0].directionId).toBe(0);
  });
  it('keeps two branches for diverging patterns', () => {
    const br = diagramBranches(mkNet([pat(['a', 'b', 'c', 'd'], 100), pat(['a', 'b', 'e'], 20)]), 'C1');
    expect(br.map((b) => b.stations)).toEqual([['Sa', 'Sb', 'Sc', 'Sd'], ['Sa', 'Sb', 'Se']]);
  });
  it('separates directions, ignores other lines and dedupes consecutive stations', () => {
    const net = mkNet([pat(['a', 'b', 'b2', 'c'], 10, 0), pat(['c', 'b', 'a'], 10, 1), pat(['a', 'e'], 5, 0, 'C2')]);
    const br = diagramBranches(net, 'C1');
    expect(br.map((b) => [b.directionId, b.stations])).toEqual([[0, ['Sa', 'Sb', 'Sc']], [1, ['Sc', 'Sb', 'Sa']]]);
  });
});

describe('placeRunsOnDiagram', () => {
  const net = mkNet([pat(['a', 'b', 'c', 'd'], 100)]);
  const branch = diagramBranches(net, 'C1')[0];
  const t0 = 1_000_000;
  const run = (id: string, stops: VehicleRun['stops']): VehicleRun => ({ id, lineId: 'C1', direction: 'd', destination: 'd', stops, hasPrevious: true, prevInferred: false });
  it('places a run mid-way between B and C', () => {
    const r = run('r1', [{ quay: 'b', arr: null, dep: t0 }, { quay: 'c', arr: t0 + 60_000, dep: null }]);
    const [p] = placeRunsOnDiagram(branch, [r], net, t0 + 30_000);
    expect(p.runId).toBe('r1');
    expect(p.afterIndex).toBe(1);
    expect(p.fraction).toBeCloseTo(0.5, 6);
  });
  it('places a run at a platform with fraction 0 and skips runs off the branch', () => {
    const at = run('r2', [{ quay: 'b', arr: t0, dep: t0 + 60_000 }, { quay: 'c', arr: t0 + 120_000, dep: null }]);
    const off = run('r3', [{ quay: 'e', arr: null, dep: t0 }, { quay: 'x', arr: t0 + 60_000, dep: null }]);
    const res = placeRunsOnDiagram(branch, [at, off], net, t0 + 30_000);
    expect(res).toEqual([{ runId: 'r2', afterIndex: 1, fraction: 0 }]);
  });
  it('ignores a run dwelling at B heading the other way (c>b>a), and a run ending at B coming from the wrong side', () => {
    const back = run('r4', [{ quay: 'c', arr: null, dep: t0 - 60_000 }, { quay: 'b', arr: t0, dep: t0 + 60_000 }, { quay: 'a', arr: t0 + 120_000, dep: null }]);
    const endsB = run('r5', [{ quay: 'c', arr: null, dep: t0 - 60_000 }, { quay: 'b', arr: t0, dep: null }]);
    expect(placeRunsOnDiagram(branch, [back, endsB], net, t0 + 30_000)).toEqual([]);
    const endsOk = run('r6', [{ quay: 'a', arr: null, dep: t0 - 60_000 }, { quay: 'b', arr: t0, dep: null }]);
    expect(placeRunsOnDiagram(branch, [endsOk], net, t0 + 30_000)).toEqual([{ runId: 'r6', afterIndex: 1, fraction: 0 }]);
  });
});

describe('line slugs', () => {
  const net = mkNet([]);
  it('builds slugs per mode', () => {
    expect(lineSlug(net.lines.C1)).toBe('m1');
    expect(lineSlug(net.lines.C5)).toBe('m7b');
    expect(lineSlug(net.lines.C2)).toBe('rer-b');
    expect(lineSlug(net.lines.C3)).toBe('t3a');
    expect(lineSlug(net.lines.C4)).toBe('j');
  });
  it('resolves slugs and ids, rejects unknown', () => {
    expect(resolveLineId(net, 'rer-b')).toBe('C2');
    expect(resolveLineId(net, 'M1')).toBe('C1');
    expect(resolveLineId(net, 'c01371')).toBeNull();
    expect(resolveLineId(net, 'C3')).toBe('C3');
    expect(resolveLineId(net, 'zzz')).toBeNull();
  });
});

describe('createDiagramSmoother', () => {
  it('holds a train in place on a small step back in the same section, but not across sections or big jumps', () => {
    const sm = createDiagramSmoother();
    sm([{ runId: 'r', afterIndex: 1, fraction: 0.6 }]);
    expect(sm([{ runId: 'r', afterIndex: 1, fraction: 0.5 }])[0].fraction).toBe(0.6);
    expect(sm([{ runId: 'r', afterIndex: 2, fraction: 0.1 }])[0]).toEqual({ runId: 'r', afterIndex: 2, fraction: 0.1 });
    sm([{ runId: 'r', afterIndex: 2, fraction: 0.9 }]);
    expect(sm([{ runId: 'r', afterIndex: 2, fraction: 0.2 }])[0].fraction).toBe(0.2);
  });
});
