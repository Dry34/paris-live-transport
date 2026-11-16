import { describe, it, expect } from 'vitest';
import type { Network, VehicleRun } from '../lib/types';
import { positionAt, createSmoother, type RunPosition } from '../lib/client/interpolate';

const net = {
  quays: {
    A: { id: 'A', name: 'A', lon: 0, lat: 0, stationId: 'sA' },
    B: { id: 'B', name: 'B', lon: 0, lat: 0.01, stationId: 'sB' },
    X: { id: 'X', name: 'X', lon: 1, lat: 1, stationId: 'sX' },
  },
  segments: { 'A>B': { coords: [[0, 0], [0, 0.01]], seconds: 60 } },
} as unknown as Network;

const t0 = 1_000_000_000;
const mk = (stops: VehicleRun['stops']): VehicleRun => ({
  id: 'r', lineId: 'L', direction: 'd', destination: 'B', stops, hasPrevious: false, prevInferred: false,
});

describe('positionAt', () => {
  const run = mk([{ quay: 'A', arr: null, dep: t0 }, { quay: 'B', arr: t0 + 60_000, dep: null }]);
  it('moving at mid-segment', () => {
    const p = positionAt(run, net, t0 + 30_000)!;
    expect(p.state).toBe('moving');
    expect(p.segmentKey).toBe('A>B');
    expect(p.fraction).toBeCloseTo(0.5, 6);
    expect(p.coord[1]).toBeCloseTo(0.005, 6);
    expect(p.nextQuay).toBe('B');
    expect(p.nextTime).toBe(t0 + 60_000);
  });
  it('returns null (no throw) when the segment has no coordinates', () => {
    const empty = { ...net, segments: { 'A>B': { coords: [], seconds: 60 } } } as unknown as Network;
    expect(positionAt(run, empty, t0 + 30_000)).toBeNull();
  });
  it('uses the single point of a one-point segment', () => {
    const one = { ...net, segments: { 'A>B': { coords: [[3, 4]], seconds: 60 } } } as unknown as Network;
    expect(positionAt(run, one, t0 + 30_000)!.coord).toEqual([3, 4]);
  });
  it('waiting before first departure', () => {
    const p = positionAt(run, net, t0 - 10_000)!;
    expect(p.state).toBe('waiting');
    expect(p.coord).toEqual([0, 0]);
  });
  it('null after last arrival + 60 s', () => {
    expect(positionAt(run, net, t0 + 60_000 + 61_000)).toBeNull();
    expect(positionAt(run, net, t0 + 60_000 + 59_000)!.state).toBe('dwelling');
  });
  it('dwelling between arr and dep', () => {
    const r = mk([{ quay: 'A', arr: null, dep: t0 }, { quay: 'B', arr: t0 + 60_000, dep: t0 + 80_000 }]);
    const p = positionAt(r, net, t0 + 70_000)!;
    expect(p.state).toBe('dwelling');
    expect(p.coord).toEqual([0, 0.01]);
  });
  it('terminus (no previous station): drawn waiting only within 10 min of departure', () => {
    expect(positionAt(run, net, t0 - 10 * 60_000)!.state).toBe('waiting');
    expect(positionAt(run, net, t0 - 10 * 60_000 - 1)).toBeNull();
  });
  it('previous station (inferred or real): drawn waiting only within 60 s of leaving it', () => {
    const inferred = { ...run, hasPrevious: true, prevInferred: true };
    expect(positionAt(inferred, net, t0 - 60_000)!.state).toBe('waiting');
    expect(positionAt(inferred, net, t0 - 61_000)).toBeNull();
    const real = { ...run, hasPrevious: true, prevInferred: false };
    expect(positionAt(real, net, t0 - 61_000)).toBeNull();
    expect(positionAt(inferred, net, t0 + 30_000)!.state).toBe('moving');
  });
  it("hide: 'always' is never drawn, 'whileWaiting' only once it has left", () => {
    expect(positionAt({ ...run, hide: 'always' }, net, t0 + 30_000)).toBeNull();
    expect(positionAt({ ...run, hide: 'whileWaiting' }, net, t0 - 10_000)).toBeNull();
    expect(positionAt({ ...run, hide: 'whileWaiting' }, net, t0 + 30_000)!.state).toBe('moving');
  });
  it('null on missing segment or unknown quay', () => {
    const r = mk([{ quay: 'A', arr: null, dep: t0 }, { quay: 'X', arr: t0 + 60_000, dep: null }]);
    expect(positionAt(r, net, t0 + 30_000)).toBeNull();
    const r2 = mk([{ quay: 'Z', arr: null, dep: t0 }, { quay: 'B', arr: t0 + 60_000, dep: null }]);
    expect(positionAt(r2, net, t0 - 1000)).toBeNull();
  });
});

describe('createSmoother', () => {
  const p = (fraction: number, segmentKey: string | null = 'A>B'): RunPosition => ({
    coord: [0, fraction], state: 'moving', segmentKey, fraction, nextQuay: 'B', nextTime: 0,
  });
  it('never goes backwards on the same segment', () => {
    const s = createSmoother();
    expect(s('r', p(0.5))!.fraction).toBe(0.5);
    expect(s('r', p(0.45))!.fraction).toBe(0.5);
    expect(s('r', p(0.6))!.fraction).toBe(0.6);
    expect(s('r', p(0.1, 'B>C'))!.fraction).toBe(0.1);
  });
  it('accepts large backward jump (>0.5) and isolates runs', () => {
    const s = createSmoother();
    s('r', p(0.9));
    expect(s('r', p(0.3))!.fraction).toBe(0.3);
    s('q', p(0.8));
    expect(s('r', p(0.35))!.fraction).toBe(0.35);
  });
  it('passes null through', () => {
    expect(createSmoother()('r', null)).toBeNull();
  });
});
