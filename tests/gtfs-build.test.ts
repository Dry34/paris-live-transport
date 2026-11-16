import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import type { LngLat, Pattern, Quay } from '../lib/types';
import { distanceM } from '../lib/geo';
import {
  buildPatterns,
  buildSegments,
  buildStations,
  computeRuntimes,
  groupStopTimes,
  simplifyLine,
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
