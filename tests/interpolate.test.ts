import { describe, it, expect } from 'vitest';
import type { Network, VehicleRun } from '../lib/types';
import { positionAt, createSmoother, MAX_HOLD_MS, type RunPosition } from '../lib/client/interpolate';

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
  // Run A -> B -> C; positions expressed along it.
  const run3 = (stops = ['A', 'B', 'C']): VehicleRun => mk(stops.map((quay) => ({ quay, arr: 0, dep: 0 })));
  const moving = (from: string, to: string, fraction: number): RunPosition => ({
    coord: [fraction, 0], state: 'moving', segmentKey: `${from}>${to}`, fraction, nextQuay: to, nextTime: 0, bearing: 0,
  });
  const at = (quay: string): RunPosition => ({ coord: [9, 9], state: 'dwelling', segmentKey: null, fraction: 0, nextQuay: quay, nextTime: 0, bearing: 0 });

  it('never goes backwards on the same segment', () => {
    const s = createSmoother();
    expect(s(run3(), moving('A', 'B', 0.5), 0)!.fraction).toBe(0.5);
    expect(s(run3(), moving('A', 'B', 0.2), 1000)!.fraction).toBe(0.5);
    expect(s(run3(), moving('A', 'B', 0.6), 2000)!.fraction).toBe(0.6);
  });
  it('holds a train that a fresher estimate puts back in an earlier section or at an earlier station', () => {
    const s = createSmoother();
    s(run3(), moving('B', 'C', 0.3), 0);
    expect(s(run3(), moving('A', 'B', 0.9), 1000)).toMatchObject({ segmentKey: 'B>C', fraction: 0.3 });
    expect(s(run3(), at('B'), 2000)).toMatchObject({ segmentKey: 'B>C', fraction: 0.3 });
    // The estimate catches up: the train moves on.
    expect(s(run3(), moving('B', 'C', 0.35), 3000)).toMatchObject({ segmentKey: 'B>C', fraction: 0.35 });
  });
  it('a train held at a station waits there', () => {
    const s = createSmoother();
    s(run3(), at('B'), 0);
    expect(s(run3(), moving('A', 'B', 0.8), 1000)).toMatchObject({ state: 'dwelling', nextQuay: 'B' });
    expect(s(run3(), moving('B', 'C', 0.1), 2000)).toMatchObject({ segmentKey: 'B>C' });
  });
  it('gives up holding after MAX_HOLD_MS and takes the fresh position', () => {
    const s = createSmoother();
    s(run3(), moving('B', 'C', 0.3), 0);
    expect(s(run3(), moving('A', 'B', 0.5), 1000)!.segmentKey).toBe('B>C');
    expect(s(run3(), moving('A', 'B', 0.5), 1000 + MAX_HOLD_MS + 1)!.segmentKey).toBe('A>B');
  });
  it('accepts the fresh position when the shown one is no longer on the run (stop dropped as passed)', () => {
    const s = createSmoother();
    s(run3(['X', 'A', 'B']), moving('X', 'A', 0.5), 0);
    expect(s(run3(), moving('A', 'B', 0.2), 1000)!.segmentKey).toBe('A>B');
  });
  it('isolates runs and passes null through', () => {
    const s = createSmoother();
    s(run3(), moving('B', 'C', 0.9), 0);
    expect(s({ ...run3(), id: 'q' }, moving('A', 'B', 0.1), 0)!.segmentKey).toBe('A>B');
    expect(s(run3(), null, 0)).toBeNull();
    expect(s(run3(), moving('A', 'B', 0.1), 0)!.segmentKey).toBe('A>B');
  });
});

describe('positionAt synthetic dwell', () => {
  const line = (mode: string) => ({ lines: { L: { mode } } });
  const net3 = {
    quays: {
      A: { id: 'A', name: 'A', lon: 0, lat: 0, stationId: 'sA' },
      B: { id: 'B', name: 'B', lon: 0, lat: 0.005, stationId: 'sB' },
      C: { id: 'C', name: 'C', lon: 0, lat: 0.01, stationId: 'sC' },
    },
    segments: {
      'A>B': { coords: [[0, 0], [0, 0.005]], seconds: 60 },
      'B>C': { coords: [[0, 0.005], [0, 0.01]], seconds: 60 },
    },
  };
  // Metro feed: same arrival and departure time at B.
  const r = mk([{ quay: 'A', arr: null, dep: t0 }, { quay: 'B', arr: t0 + 60_000, dep: t0 + 60_000 }, { quay: 'C', arr: t0 + 120_000, dep: null }]);
  it('stops a metro 20 s at a station the feed gives no dwell for, centred on the feed time', () => {
    const n = { ...net3, ...line('metro') } as unknown as Network;
    expect(positionAt(r, n, t0 + 50_000 - 1)!.state).toBe('moving');
    expect(positionAt(r, n, t0 + 50_000)!.state).toBe('dwelling');
    expect(positionAt(r, n, t0 + 69_999)!.state).toBe('dwelling');
    expect(positionAt(r, n, t0 + 70_000)!.state).toBe('moving');
  });
  it('uses 30 s for RER and keeps real dwells untouched', () => {
    const n = { ...net3, ...line('rer') } as unknown as Network;
    expect(positionAt(r, n, t0 + 45_000)!.state).toBe('dwelling');
    expect(positionAt(r, n, t0 + 44_000)!.state).toBe('moving');
    const real = mk([{ quay: 'A', arr: null, dep: t0 }, { quay: 'B', arr: t0 + 60_000, dep: t0 + 70_000 }, { quay: 'C', arr: t0 + 120_000, dep: null }]);
    expect(positionAt(real, n, t0 + 59_000)!.state).toBe('moving');
    expect(positionAt(real, n, t0 + 65_000)!.state).toBe('dwelling');
  });
  it('never takes more than a third of a short section', () => {
    // A 55 m section, so the speed cap does not hide the train.
    const n = { ...net3, segments: { ...net3.segments, 'A>B': { coords: [[0, 0], [0, 0.0005]], seconds: 15 } }, ...line('metro') } as unknown as Network;
    const short = mk([{ quay: 'A', arr: null, dep: t0 }, { quay: 'B', arr: t0 + 15_000, dep: t0 + 15_000 }, { quay: 'C', arr: t0 + 75_000, dep: null }]);
    expect(positionAt(short, n, t0 + 9_000)!.state).toBe('moving');
    expect(positionAt(short, n, t0 + 11_000)!.state).toBe('dwelling');
  });
});

describe('positionAt bearing', () => {
  const east = {
    quays: {
      A: { id: 'A', name: 'A', lon: 0, lat: 0, stationId: 'sA' },
      B: { id: 'B', name: 'B', lon: 0, lat: 0.01, stationId: 'sB' },
      C: { id: 'C', name: 'C', lon: 0.01, lat: 0.01, stationId: 'sC' },
    },
    segments: {
      'A>B': { coords: [[0, 0], [0, 0.01]], seconds: 60 },
      'B>C': { coords: [[0, 0.01], [0.01, 0.01]], seconds: 60 },
    },
  } as unknown as Network;
  const run = mk([
    { quay: 'A', arr: null, dep: t0 },
    { quay: 'B', arr: t0 + 60_000, dep: t0 + 80_000 },
    { quay: 'C', arr: t0 + 140_000, dep: null },
  ]);
  it('moving: bearing of the track (north on A>B, east on B>C)', () => {
    expect(positionAt(run, east, t0 + 30_000)!.bearing).toBeCloseTo(0, 0);
    expect(positionAt(run, east, t0 + 110_000)!.bearing).toBeCloseTo(90, 0);
  });
  it('waiting / dwelling: heading of the next section', () => {
    expect(positionAt(run, east, t0 - 5_000)!.bearing).toBeCloseTo(0, 0);
    expect(positionAt(run, east, t0 + 70_000)!.bearing).toBeCloseTo(90, 0);
  });
  it('at the last stop: heading of the section it arrived on', () => {
    expect(positionAt(run, east, t0 + 150_000)!.bearing).toBeCloseTo(90, 0);
  });
  it('null when no section geometry is known around the quay', () => {
    const lone = mk([{ quay: 'A', arr: null, dep: t0 }]);
    expect(positionAt(lone, east, t0 - 5_000)!.bearing).toBeNull();
  });
});

describe('positionAt implied speed cap (hide instead of teleporting)', () => {
  const M_PER_DEG = 111_195;
  const netWith = (lengthM: number) => ({
    lines: {
      M: { id: 'M', shortName: 'M', mode: 'metro', color: '', textColor: '', longName: '' },
      T: { id: 'T', shortName: 'T', mode: 'tram', color: '', textColor: '', longName: '' },
      R: { id: 'R', shortName: 'R', mode: 'rer', color: '', textColor: '', longName: '' },
    },
    quays: {
      A: { id: 'A', name: 'A', lon: 0, lat: 0, stationId: 'sA' },
      B: { id: 'B', name: 'B', lon: 0, lat: lengthM / M_PER_DEG, stationId: 'sB' },
    },
    segments: { 'A>B': { coords: [[0, 0], [0, lengthM / M_PER_DEG]], seconds: 60 } },
  }) as unknown as Network;
  const runOn = (lineId: string): VehicleRun => ({
    ...mk([{ quay: 'A', arr: null, dep: t0 }, { quay: 'B', arr: t0 + 60_000, dep: null }]),
    lineId,
  });
  it('metro: 10 km in 60 s (600 km/h) is hidden', () => {
    expect(positionAt(runOn('M'), netWith(10_000), t0 + 30_000)).toBeNull();
  });
  it('metro: 1 km in 60 s (60 km/h) is drawn', () => {
    expect(positionAt(runOn('M'), netWith(1_000), t0 + 30_000)!.state).toBe('moving');
  });
  it('tram: 1.6 km in 60 s (96 km/h) is hidden', () => {
    expect(positionAt(runOn('T'), netWith(1_600), t0 + 30_000)).toBeNull();
  });
  it('rer: 2.5 km in 60 s (150 km/h) is drawn', () => {
    expect(positionAt(runOn('R'), netWith(2_500), t0 + 30_000)!.state).toBe('moving');
  });
  it('unknown line: no cap', () => {
    expect(positionAt(runOn('?'), netWith(10_000), t0 + 30_000)!.state).toBe('moving');
  });
  it('the cap only applies while moving: the same train dwelling at B is drawn', () => {
    const r = { ...runOn('M'), stops: [{ quay: 'A', arr: null, dep: t0 }, { quay: 'B', arr: t0 + 60_000, dep: t0 + 90_000 }] };
    expect(positionAt(r, netWith(10_000), t0 + 70_000)!.state).toBe('dwelling');
  });
});
