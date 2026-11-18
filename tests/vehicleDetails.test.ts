import { describe, expect, it } from 'vitest';
import type { Network, VehicleRun } from '../lib/types';
import { positionAt } from '../lib/client/interpolate';
import {
  currentDelaySec,
  estimatedSpeedKmh,
  formatDelay,
  formatEta,
  neighborGaps,
  upcomingStops,
  clockTime,
} from '../lib/client/vehicleDetails';

const L = 'L';
/** Latitude step of exactly 1 km for lib/geo's haversine radius. */
const KM_LAT = 1000 / ((6371008.8 * Math.PI) / 180);

const mkNet = (): Network => {
  const quays: Network['quays'] = {};
  const stations: Network['stations'] = {};
  for (let n = 1; n <= 6; n++) {
    const name = n === 6 ? 'Terminus Six' : `S${n}`;
    const lat = 48 + n * KM_LAT;
    quays[`q${n}`] = { id: `q${n}`, name, lon: 2, lat, stationId: `S${n}` };
    stations[`S${n}`] = { id: `S${n}`, name, lon: 2, lat, quays: [`q${n}`], lines: n === 4 ? [L, 'M2'] : [L] };
  }
  const segments: Network['segments'] = {};
  for (let n = 1; n < 6; n++) {
    const a = quays[`q${n}`];
    const b = quays[`q${n + 1}`];
    segments[`q${n}>q${n + 1}`] = { coords: [[a.lon, a.lat], [b.lon, b.lat]], seconds: 90 };
  }
  return {
    generatedAt: '',
    lines: {
      [L]: { id: L, shortName: 'L', mode: 'metro', color: '#fc0', textColor: '#000', longName: 'Ligne L', shapes: [] },
      M2: { id: 'M2', shortName: '2', mode: 'metro', color: '#00f', textColor: '#fff', longName: 'Ligne 2', shapes: [] },
    },
    quays,
    stations,
    patterns: [
      { lineId: L, directionId: 0, quays: ['q1', 'q2', 'q3', 'q4', 'q5', 'q6'], trips: 100, headsign: 'Terminus Six' },
      { lineId: L, directionId: 0, quays: ['q1', 'q2', 'q3', 'q4'], trips: 20, headsign: 'S4' },
    ],
    segments,
  };
};

const net = mkNet();
const now = 1_700_000_000_000;
const s = (sec: number) => now + sec * 1000;

const run = (id: string, stops: [string, number | null, number | null, (number | null)?][], extra: Partial<VehicleRun> = {}): VehicleRun => ({
  id, lineId: L, direction: 'A', destination: 'Terminus Six', hasPrevious: true, prevInferred: false,
  stops: stops.map(([quay, arr, dep, delaySec]) => ({ quay, arr, dep, delaySec })), ...extra,
});

describe('upcomingStops', () => {
  const r = run('r1', [['q2', s(-40), s(-30)], ['q3', s(60), null]]);

  it('lists the known stop then estimates up to the terminus', () => {
    const up = upcomingStops(r, net, now);
    expect(up.map((u) => [u.quay, u.time, u.estimated])).toEqual([
      ['q3', s(60), false],
      ['q4', s(60 + 20 + 90), true],
      ['q5', s(60 + 20 + 90 + 20 + 90), true],
      ['q6', s(60 + 20 + 90 + 20 + 90 + 20 + 90), true],
    ]);
    expect(up[up.length - 1].name).toBe('Terminus Six');
    expect(up[0]).toMatchObject({ stationId: 'S3', name: 'S3', correspondences: [] });
    expect(up[1].correspondences).toEqual(['M2']);
  });

  it('falls back to the most frequent pattern containing the known stops when the destination is unknown', () => {
    const up = upcomingStops({ ...r, destination: 'Ailleurs' }, net, now);
    expect(up.map((u) => u.quay)).toEqual(['q3', 'q4', 'q5', 'q6']);
  });

  it('follows the pattern whose terminus matches the destination even when less frequent', () => {
    const up = upcomingStops({ ...r, destination: 's4' }, net, now);
    expect(up.map((u) => u.quay)).toEqual(['q3', 'q4']);
  });

  it('keeps only the known stops when no pattern contains them', () => {
    const odd = run('r2', [['q3', s(-40), s(-30)], ['q2', s(60), null]]);
    expect(upcomingStops(odd, net, now).map((u) => [u.quay, u.estimated])).toEqual([['q2', false]]);
  });

  it('drops stops more than 30 s in the past and the previous stop', () => {
    const r3 = run('r3', [['q1', s(-200), s(-190)], ['q2', s(-40), s(-35)], ['q3', s(-10), s(10)]]);
    expect(upcomingStops(r3, net, now)[0].quay).toBe('q3');
    const first = run('r4', [['q1', null, s(30)], ['q2', s(120), s(130)]], { hasPrevious: false });
    expect(upcomingStops(first, net, now)[0].quay).toBe('q1');
  });
});

describe('formatEta', () => {
  it('formats real and estimated times', () => {
    expect(formatEta(s(30), now, false)).toBe('imminent');
    expect(formatEta(s(125), now, false)).toBe('2 min');
    expect(formatEta(s(30), now, true)).toBe('~1 min');
    expect(formatEta(s(125), now, true)).toBe('~2 min');
  });
});

describe('estimatedSpeedKmh', () => {
  const r = run('r1', [['q2', s(-40), s(-30)], ['q3', s(60), null]]);
  it('divides the section length by its duration', () => {
    const pos = positionAt(r, net, now)!;
    expect(pos.state).toBe('moving');
    expect(estimatedSpeedKmh(r, pos, net)).toBe(40);
  });
  it('is null for a dwelling train', () => {
    const d = run('r5', [['q2', s(-200), s(-190)], ['q3', s(-10), s(20)], ['q4', s(110), null]]);
    const pos = positionAt(d, net, now)!;
    expect(pos.state).toBe('dwelling');
    expect(estimatedSpeedKmh(d, pos, net)).toBeNull();
  });
});

describe('delay', () => {
  it('reads the delay of the next stop', () => {
    const r = run('r1', [['q2', s(-40), s(-30), 0], ['q3', s(60), null, 125]]);
    expect(currentDelaySec(r, positionAt(r, net, now)!)).toBe(125);
    const unknown = run('r1', [['q2', s(-40), s(-30)], ['q3', s(60), null]]);
    expect(currentDelaySec(unknown, positionAt(unknown, net, now)!)).toBeNull();
  });
  it('formats delays', () => {
    expect(formatDelay(125)).toEqual({ text: '+2 min', tone: 'late' });
    expect(formatDelay(30)).toEqual({ text: "à l'heure", tone: 'on-time' });
    expect(formatDelay(-90)).toEqual({ text: '−1 min', tone: 'early' });
    expect(formatDelay(null)).toBeNull();
  });
});

describe('neighborGaps', () => {
  const at4 = (id: string, sec: number, extra: Partial<VehicleRun> = {}) =>
    run(id, [['q3', null, s(-20)], ['q4', s(sec), s(sec + 20)]], extra);
  const me = at4('me', 240);

  it('measures the gaps to the trains ahead and behind at the next station', () => {
    const runs = [at4('a', 60), me, at4('b', 480), at4('x', 200, { direction: 'B' })];
    expect(neighborGaps(me, runs, net, now)).toEqual({ aheadMin: 3, behindMin: 4 });
  });
  it('gives nulls for a train alone in its direction', () => {
    expect(neighborGaps(me, [me, at4('x', 200, { direction: 'B' })], net, now)).toEqual({ aheadMin: null, behindMin: null });
  });
  it('ignores a run no longer on the map', () => {
    const stale = run('old', [['q3', s(-2400), s(-2390)], ['q4', s(-2300), s(-2290)]]);
    expect(neighborGaps(me, [me, stale], net, now)).toEqual({ aheadMin: null, behindMin: null });
  });
  it('ignores an inferred previous stop', () => {
    const inferred = run('i', [['q4', s(120), s(130)], ['q5', s(220), null]], { prevInferred: true });
    expect(neighborGaps(me, [me, inferred], net, now)).toEqual({ aheadMin: null, behindMin: null });
  });
});

describe('upcomingStops while dwelling', () => {
  it('keeps the station a train has been standing at for more than 30 s, flagged at platform', () => {
    const r = run('dw', [['q2', s(-200), s(-190)], ['q3', s(-60), s(20)], ['q4', s(110), null]]);
    const up = upcomingStops(r, net, now);
    expect(up[0]).toMatchObject({ quay: 'q3', atPlatform: true });
    expect(up[1]).toMatchObject({ quay: 'q4', atPlatform: false });
  });
});

describe('clockTime', () => {
  it('formats HH:MM in Europe/Paris', () => {
    expect(clockTime(Date.parse('2026-11-16T16:05:00Z'))).toBe('17:05');
  });
});
