import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import type { LngLat, Pattern, Quay, Segment, Station } from '../lib/types';
import { cumulativeLengths, distanceM } from '../lib/geo';
import {
  buildPatterns,
  lineShapesFromSegments,
  buildSegments,
  buildStations,
  computeRuntimes,
  groupStopTimes,
  simplifyLine,
  snapQuaysToSegments,
  stationLinePoints,
  type GtfsStop,
  type GtfsStopTime,
  type GtfsTrip,
} from '../lib/static/gtfs-build';

const dir = path.join(__dirname, 'fixtures/gtfs-mini');
const read = <T>(f: string): T[] => parse(readFileSync(path.join(dir, f), 'utf8'), { columns: true, skip_empty_lines: true });

const trips = read<GtfsTrip>('trips.txt');
const stopTimes = read<GtfsStopTime>('stop_times.txt');
const stops = read<GtfsStop>('stops.txt');
const shapeRows = read<{ shape_id: string; shape_pt_lat: string; shape_pt_lon: string; shape_pt_sequence: string }>('shapes.txt');
const shapes = new Map<string, LngLat[]>();
for (const r of [...shapeRows].sort((a, b) => Number(a.shape_pt_sequence) - Number(b.shape_pt_sequence))) {
  const list = shapes.get(r.shape_id) ?? [];
  list.push([Number(r.shape_pt_lon), Number(r.shape_pt_lat)]);
  shapes.set(r.shape_id, list);
}
const byTrip = groupStopTimes(stopTimes);

describe('buildPatterns', () => {
  const patterns = buildPatterns(trips, byTrip);
  it('groups trips by exact quay sequence and drops rare patterns (< 2 %)', () => {
    expect(patterns).toHaveLength(2);
    const d0 = patterns.find((p) => p.directionId === 0)!;
    const d1 = patterns.find((p) => p.directionId === 1)!;
    expect(d0.quays).toEqual(['A', 'B', 'C', 'D']);
    expect(d1.quays).toEqual(['D', 'C', 'B', 'A']);
    expect(d0.trips).toBe(50);
    expect(d1.trips).toBe(10);
    expect(d0.lineId).toBe('C01371');
    expect(patterns.some((p) => p.quays.join() === 'A,B,C')).toBe(false);
  });
  it('uses the most frequent headsign', () => {
    expect(patterns.find((p) => p.directionId === 1)!.headsign).toBe('Station A');
  });
  it('keeps a pattern at exactly the 2 % share or above', () => {
    // 49 + 1 → the rare one is 2 % exactly: kept
    const subset = trips.filter((t) => t.trip_id !== 'T0-49');
    expect(buildPatterns(subset, byTrip).some((p) => p.quays.join() === 'A,B,C')).toBe(true);
  });
});

describe('buildSegments', () => {
  const patterns = buildPatterns(trips, byTrip);
  const { quays } = buildStations(stops, new Set(['A', 'B', 'C', 'D']), patterns);
  const shapeOf = new Map<Pattern, LngLat[]>(patterns.map((p) => [p, shapes.get(p.directionId === 0 ? 'SH0' : 'SH1')!]));
  const runtimes = computeRuntimes(byTrip);
  const segments = buildSegments(patterns, quays, shapeOf, runtimes);

  it('creates a segment per consecutive quay pair in both directions', () => {
    expect(Object.keys(segments).sort()).toEqual(['A>B', 'B>A', 'B>C', 'C>B', 'C>D', 'D>C']);
  });
  it('uses the median runtime (arrival B − departure A)', () => {
    expect(runtimes.get('A>B')!.length).toBe(51);
    expect(segments['A>B'].seconds).toBe(70);
    expect(segments['B>C'].seconds).toBe(90);
  });
  it('follows the shape from A to B', () => {
    const c = segments['A>B'].coords;
    expect(distanceM(c[0], [quays.A.lon, quays.A.lat])).toBeLessThan(1);
    expect(distanceM(c[c.length - 1], [quays.B.lon, quays.B.lat])).toBeLessThan(1);
    const r = segments['B>A'].coords;
    expect(distanceM(r[0], [quays.B.lon, quays.B.lat])).toBeLessThan(1);
  });
  it('falls back to a straight line when a quay is far from the shape', () => {
    const far: Record<string, Quay> = { ...quays, E: { id: 'E', name: 'E', lon: 2.34, lat: 48.85 + 300 / 111195, stationId: 'E' } };
    const p: Pattern = { lineId: 'C01371', directionId: 0, quays: ['D', 'E'], trips: 5, headsign: 'E' };
    const seg = buildSegments([p], far, new Map([[p, shapes.get('SH0')!]]), new Map());
    expect(seg['D>E'].coords).toHaveLength(2);
    // no runtime → distance at 10 m/s
    const d = distanceM([far.D.lon, far.D.lat], [far.E.lon, far.E.lat]);
    expect(seg['D>E'].seconds).toBeCloseTo(d / 10, 0);
  });
  it('falls back to a straight line when the shape is missing', () => {
    const p = patterns[0];
    const seg = buildSegments([p], quays, new Map(), runtimes);
    expect(seg['A>B'].coords).toHaveLength(2);
    expect(seg['A>B'].seconds).toBe(70);
  });
  it('searches the projection of B only after A (loop shapes)', () => {
    // shape passes near B first, then A, then B again
    const loop: LngLat[] = [[2.31, 48.85], [2.31, 48.851], [2.30, 48.851], [2.30, 48.85], [2.31, 48.85]];
    const p: Pattern = { lineId: 'C01371', directionId: 0, quays: ['A', 'B'], trips: 5, headsign: 'B' };
    const seg = buildSegments([p], quays, new Map([[p, loop]]), new Map());
    const c = seg['A>B'].coords;
    expect(distanceM(c[0], [quays.A.lon, quays.A.lat])).toBeLessThan(1);
    expect(distanceM(c[c.length - 1], [quays.B.lon, quays.B.lat])).toBeLessThan(1);
    expect(c.length).toBe(2); // A→B along the last leg only, not backwards around the loop
  });
  it('picks the shortest forward slice when the shape passes A several times (zigzag / terminal loop)', () => {
    // three parallel legs ~55 m apart: east on 48.85, back west on 48.8505, east again on 48.851.
    // A's global nearest point is on the return leg; projecting from there runs the long way to leg 3.
    const zigzag: LngLat[] = [
      [2.30, 48.85], [2.3075, 48.85], [2.32, 48.85],
      [2.32, 48.8505], [2.30, 48.8505],
      [2.30, 48.851], [2.32, 48.851],
    ];
    const q: Record<string, Quay> = {
      A: { id: 'A', name: 'A', lon: 2.305, lat: 48.8504, stationId: 'A' },
      B: { id: 'B', name: 'B', lon: 2.31, lat: 48.8501, stationId: 'B' },
    };
    const p: Pattern = { lineId: 'C01371', directionId: 0, quays: ['A', 'B'], trips: 5, headsign: 'B' };
    const c = buildSegments([p], q, new Map([[p, zigzag]]), new Map())['A>B'].coords;
    const straight = distanceM([q.A.lon, q.A.lat], [q.B.lon, q.B.lat]);
    const len = cumulativeLengths(c).at(-1)!;
    expect(c.length).toBeGreaterThan(2); // follows the shape (through the 2.3075 vertex), not a fallback
    expect(len).toBeGreaterThan(0.8 * straight);
    expect(len).toBeLessThan(1.2 * straight);
    expect(distanceM(c[0], [2.305, 48.85])).toBeLessThan(1);
  });
  it('falls back to a straight line when even the shortest slice is implausibly long', () => {
    // the shape leaves A, makes a 3 km detour north and only then reaches B (735 m from A)
    const detour: LngLat[] = [[2.30, 48.85], [2.30, 48.88], [2.31, 48.88], [2.31, 48.85]];
    const p: Pattern = { lineId: 'C01371', directionId: 0, quays: ['A', 'B'], trips: 5, headsign: 'B' };
    const seg = buildSegments([p], quays, new Map([[p, detour]]), new Map());
    expect(seg['A>B'].coords).toHaveLength(2);
  });
});

describe('buildStations', () => {
  const patterns = buildPatterns(trips, byTrip);
  const { quays, stations } = buildStations(stops, new Set(['A', 'B', 'C', 'D']), patterns);
  it('groups quays under their parent station', () => {
    expect(stations.S1.quays).toContain('A');
    expect(stations.S1.lines).toEqual(['C01371']);
    expect(stations.S1.name).toBe('Station A');
    expect(quays.A).toEqual({ id: 'A', name: 'Quai A', lon: 2.3, lat: 48.85, stationId: 'S1' });
    expect(Object.keys(stations).sort()).toEqual(['S1', 'S2', 'S3', 'S4']);
  });
  it('uses the quay itself as station when it has no parent', () => {
    const lone: GtfsStop = { stop_id: 'IDFM:Z', stop_name: 'Z', stop_lat: '48.8', stop_lon: '2.3', parent_station: '' };
    const p: Pattern = { lineId: 'C01372', directionId: 0, quays: ['Z'], trips: 1, headsign: '' };
    const r = buildStations([lone], new Set(['Z']), [p]);
    expect(r.quays.Z.stationId).toBe('Z');
    expect(r.stations.Z.lines).toEqual(['C01372']);
  });
});

describe('simplifyLine', () => {
  it('drops points within tolerance and keeps corners', () => {
    const line: LngLat[] = [[2.3, 48.85], [2.30001, 48.85000001], [2.301, 48.85], [2.301, 48.851]];
    expect(simplifyLine(line, 5)).toEqual([[2.3, 48.85], [2.301, 48.85], [2.301, 48.851]]);
  });
});

describe('lineShapesFromSegments', () => {
  const Q = (id: string, stationId: string, lon: number): Quay => ({ id, name: id, lon, lat: 48.9, stationId });
  const quays: Record<string, Quay> = {
    a: Q('a', 'SA', 2.0), b: Q('b', 'SB', 2.01), c: Q('c', 'SC', 2.02), d: Q('d', 'SD', 2.03),
    a2: Q('a2', 'SA', 2.0), b2: Q('b2', 'SB', 2.01), c2: Q('c2', 'SC', 2.02),
  };
  const seg = (x: number, y: number) => ({ coords: [[x, 48.9], [(x + y) / 2, 48.9], [y, 48.9]] as LngLat[], seconds: 60 });
  const segments = {
    'a>b': seg(2.0, 2.01), 'b>c': seg(2.01, 2.02), 'c>d': seg(2.02, 2.03),
    'c2>b2': seg(2.02, 2.01), 'b2>a2': seg(2.01, 2.0),
    // A segment of another line through a station this line doesn't use: never drawn for L.
    'x>y': { coords: [[2.5, 49], [2.6, 49]] as LngLat[], seconds: 60 },
  };
  const P = (quaysList: string[], trips: number, lineId = 'L'): Pattern => ({ lineId, directionId: 0, quays: quaysList, trips, headsign: '' });

  it('draws only the stop-to-stop segments the line runs on, chained, each station pair once', () => {
    const shapes = lineShapesFromSegments([P(['a', 'b', 'c', 'd'], 10), P(['c2', 'b2', 'a2'], 8), P(['x', 'y'], 5, 'OTHER')], segments, quays, 'L');
    expect(shapes).toHaveLength(1);
    expect(shapes[0][0]).toEqual([2.0, 48.9]);
    expect(shapes[0].at(-1)).toEqual([2.03, 48.9]);
    expect(shapes[0].some(([lon]) => lon > 2.1)).toBe(false);
  });

  it('starts a new polyline after a stretch already drawn', () => {
    const shapes = lineShapesFromSegments([P(['b', 'c'], 10), P(['a', 'b', 'c', 'd'], 5)], segments, quays, 'L');
    expect(shapes.map((s) => [s[0][0], s.at(-1)![0]])).toEqual([[2.01, 2.02], [2.0, 2.01], [2.02, 2.03]]);
  });
});

describe('arrêts posés sur les tracés', () => {
  const Q = (id: string, stationId: string, lon: number, lat: number): Quay => ({ id, name: id, lon, lat, stationId });

  it('déplace chaque quai sur le bout des segments qui le touchent, et réaligne les segments droits', () => {
    // quay b is 30 m north of the track; the snapped segments start/end on the track
    const quays = { a: Q('a', 'SA', 2.0, 48.9), b: Q('b', 'SB', 2.01, 48.90027), c: Q('c', 'SC', 2.02, 48.9), z: Q('z', 'SZ', 2.03, 48.95) };
    const segments: Record<string, Segment> = {
      'a>b': { coords: [[2.0, 48.9], [2.005, 48.9], [2.01, 48.9]], seconds: 60 },
      'b>c': { coords: [[2.01, 48.9], [2.02, 48.9]], seconds: 60 }, // straight fallback = old quay coords? no: already on track
      'c>z': { coords: [[2.02, 48.9], [2.03, 48.95]], seconds: 60 }, // straight fallback between quay coords
    };
    const out = snapQuaysToSegments(quays, segments);
    expect([out.quays.b.lon, out.quays.b.lat]).toEqual([2.01, 48.9]);
    expect([out.quays.z.lon, out.quays.z.lat]).toEqual([2.03, 48.95]); // only straight segments touch z: unchanged
    expect(out.segments['c>z'].coords).toEqual([[2.02, 48.9], [2.03, 48.95]]);
  });

  it('place le point d’une ligne dans une station sur le tracé de cette ligne', () => {
    // two quays on parallel tracks either side of the trace, station centroid far away (interchange)
    const quays = { q1: Q('q1', 'S', 2.01, 48.9001), q2: Q('q2', 'S', 2.01, 48.8999), m: Q('m', 'S', 2.02, 48.91) };
    const stations: Record<string, Station> = { S: { id: 'S', name: 'S', lon: 2.015, lat: 48.905, quays: ['q1', 'q2', 'm'], lines: ['L', 'M'] } };
    const patterns = [
      { lineId: 'L', directionId: 0 as const, quays: ['x', 'q1'], trips: 1, headsign: '' },
      { lineId: 'L', directionId: 1 as const, quays: ['q2', 'x'], trips: 1, headsign: '' },
      { lineId: 'M', directionId: 0 as const, quays: ['m', 'y'], trips: 1, headsign: '' },
    ];
    const shapes = { L: [[[2.0, 48.9], [2.02, 48.9]]] as LngLat[][], M: [[[2.02, 48.905], [2.02, 48.92]]] as LngLat[][] };
    const pts = stationLinePoints(stations, quays, patterns, shapes);
    expect(pts.S.L[0]).toBeCloseTo(2.01, 6);
    expect(pts.S.L[1]).toBeCloseTo(48.9, 6);
    expect(pts.S.M[0]).toBeCloseTo(2.02, 6);
    expect(pts.S.M[1]).toBeCloseTo(48.91, 6);
  });
});
