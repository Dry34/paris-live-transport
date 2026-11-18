// Pure functions building the static network from already-parsed GTFS rows.
import type { LngLat, Pattern, Quay, Segment, Station } from '../types';
import { distanceM, nearPasses, projectOnLine, sliceLine, cumulativeLengths } from '../geo';

export interface GtfsTrip { trip_id: string; route_id: string; direction_id: string; shape_id: string; trip_headsign: string }
export interface GtfsStopTime { trip_id: string; stop_id: string; stop_sequence: string; arrival_time: string; departure_time: string }
export interface GtfsStop { stop_id: string; stop_name: string; stop_lat: string; stop_lon: string; parent_station: string }

/** Minimum share of a line+direction's trips a pattern must have to be kept. */
const MIN_PATTERN_SHARE = 0.02;
/** Beyond this distance (m) between a quay and the shape, the segment is drawn straight. */
const MAX_SNAP_M = 150;
/** A shape slice longer than max(ratio × straight, straight + slack) is not trusted: drawn straight instead. */
const MAX_SLICE_RATIO = 2.5;
const MAX_SLICE_SLACK_M = 1500;
/** Fallback speed (m/s) when no runtime is known. */
const FALLBACK_SPEED = 10;

/** "IDFM:22083" → "22083" */
export const stripIdfm = (id: string): string => id.replace(/^IDFM:/, '');

/** "25:01:30" → seconds since service-day start (may exceed 86400). */
export function gtfsTimeToSeconds(t: string): number {
  const [h, m, s] = t.split(':').map(Number);
  return h * 3600 + m * 60 + s;
}

/** Groups stop_times by trip, each list ordered by stop_sequence. */
export function groupStopTimes(stopTimes: GtfsStopTime[]): Map<string, GtfsStopTime[]> {
  const byTrip = new Map<string, GtfsStopTime[]>();
  for (const st of stopTimes) {
    const list = byTrip.get(st.trip_id);
    if (list) list.push(st);
    else byTrip.set(st.trip_id, [st]);
  }
  for (const list of byTrip.values()) list.sort((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence));
  return byTrip;
}

const ordered = (list: GtfsStopTime[]): GtfsStopTime[] =>
  [...list].sort((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence));

/** Key identifying the pattern a trip belongs to: route, direction and exact quay sequence. */
export function patternKey(trip: GtfsTrip, stopTimes: GtfsStopTime[]): string {
  return `${stripIdfm(trip.route_id)}|${trip.direction_id}|${ordered(stopTimes).map((s) => stripIdfm(s.stop_id)).join('>')}`;
}

function mostFrequent(counts: Map<string, number>): string {
  let best = '';
  let bestN = -1;
  for (const [k, n] of counts) if (n > bestN) [best, bestN] = [k, n];
  return best;
}

export function buildPatterns(trips: GtfsTrip[], stopTimesByTrip: Map<string, GtfsStopTime[]>): Pattern[] {
  const groups = new Map<string, { pattern: Pattern; headsigns: Map<string, number> }>();
  const totals = new Map<string, number>(); // line|direction → trips
  for (const trip of trips) {
    const sts = stopTimesByTrip.get(trip.trip_id);
    if (!sts || sts.length < 2) continue;
    const key = patternKey(trip, sts);
    let g = groups.get(key);
    if (!g) {
      g = {
        pattern: {
          lineId: stripIdfm(trip.route_id),
          directionId: trip.direction_id === '1' ? 1 : 0,
          quays: ordered(sts).map((s) => stripIdfm(s.stop_id)),
          trips: 0,
          headsign: '',
        },
        headsigns: new Map(),
      };
      groups.set(key, g);
    }
    g.pattern.trips++;
    g.headsigns.set(trip.trip_headsign, (g.headsigns.get(trip.trip_headsign) ?? 0) + 1);
    const ld = `${g.pattern.lineId}|${g.pattern.directionId}`;
    totals.set(ld, (totals.get(ld) ?? 0) + 1);
  }
  const out: Pattern[] = [];
  for (const { pattern, headsigns } of groups.values()) {
    const total = totals.get(`${pattern.lineId}|${pattern.directionId}`)!;
    if (pattern.trips / total < MIN_PATTERN_SHARE) continue;
    pattern.headsign = mostFrequent(headsigns);
    out.push(pattern);
  }
  return out.sort((a, b) => a.lineId.localeCompare(b.lineId) || a.directionId - b.directionId || b.trips - a.trips);
}

/** Observed runtimes per consecutive quay pair "A>B": arrival at B − departure from A (s). */
export function computeRuntimes(stopTimesByTrip: Map<string, GtfsStopTime[]>): Map<string, number[]> {
  const runtimes = new Map<string, number[]>();
  for (const list of stopTimesByTrip.values()) addTripRuntimes(runtimes, ordered(list));
  return runtimes;
}

/** Adds one trip's runtimes (stop_times already ordered) into the map. */
export function addTripRuntimes(runtimes: Map<string, number[]>, sts: GtfsStopTime[]): void {
  for (let i = 0; i + 1 < sts.length; i++) {
    const a = sts[i];
    const b = sts[i + 1];
    if (!a.departure_time || !b.arrival_time) continue;
    const s = gtfsTimeToSeconds(b.arrival_time) - gtfsTimeToSeconds(a.departure_time);
    if (!(s >= 0)) continue;
    const key = `${stripIdfm(a.stop_id)}>${stripIdfm(b.stop_id)}`;
    const list = runtimes.get(key);
    if (list) list.push(s);
    else runtimes.set(key, [s]);
  }
}

function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

function segmentCoords(shape: LngLat[] | undefined, a: LngLat, b: LngLat): { coords: LngLat[]; snapped: boolean } {
  const straight = { coords: [a, b], snapped: false };
  if (!shape || shape.length < 2) return straight;
  const cum = cumulativeLengths(shape);
  // The shape may pass near A (or B) several times (loops, terminal loops, out-and-back shapes): try every
  // pass of A, pair it with the first pass of B after it, and keep the shortest forward slice. The score adds
  // the two snap distances (quay → shape → quay) so that, between near-equal slices, the closest pass wins.
  const passesB = nearPasses(shape, b, MAX_SNAP_M, cum);
  let best: { from: number; to: number; score: number } | null = null;
  for (const pa of nearPasses(shape, a, MAX_SNAP_M, cum)) {
    const pb = passesB.find((q) => q.along > pa.along);
    if (!pb) continue;
    const score = pb.along - pa.along + pa.dist + pb.dist;
    if (!best || score < best.score) best = { from: pa.along, to: pb.along, score };
  }
  if (!best) return straight;
  const d = distanceM(a, b);
  if (best.to - best.from > Math.max(MAX_SLICE_RATIO * d, d + MAX_SLICE_SLACK_M)) return straight;
  return { coords: sliceLine(shape, best.from, best.to), snapped: true };
}

export function buildSegments(
  patterns: Pattern[],
  quays: Record<string, Quay>,
  shapeOfPattern: Map<Pattern, LngLat[]>,
  runtimes: Map<string, number[]>,
): Record<string, Segment> {
  const segments: Record<string, Segment> = {};
  const snapped = new Set<string>();
  // most frequent patterns first: their geometry wins; a later pattern only replaces a straight fallback
  for (const p of [...patterns].sort((x, y) => y.trips - x.trips)) {
    const shape = shapeOfPattern.get(p);
    for (let i = 0; i + 1 < p.quays.length; i++) {
      const key = `${p.quays[i]}>${p.quays[i + 1]}`;
      if (snapped.has(key)) continue;
      const qa = quays[p.quays[i]];
      const qb = quays[p.quays[i + 1]];
      if (!qa || !qb) continue;
      const a: LngLat = [qa.lon, qa.lat];
      const b: LngLat = [qb.lon, qb.lat];
      const geo = segmentCoords(shape, a, b);
      if (segments[key] && !geo.snapped) continue;
      const rt = runtimes.get(key);
      const seconds = rt && rt.length ? median(rt) : distanceM(a, b) / FALLBACK_SPEED;
      segments[key] = { coords: geo.coords, seconds };
      if (geo.snapped) snapped.add(key);
    }
  }
  return segments;
}

export function buildStations(
  stops: GtfsStop[],
  usedQuays: Set<string>,
  patterns: Pattern[],
): { quays: Record<string, Quay>; stations: Record<string, Station> } {
  const byId = new Map(stops.map((s) => [stripIdfm(s.stop_id), s]));
  const linesOfQuay = new Map<string, Set<string>>();
  for (const p of patterns) {
    for (const q of p.quays) {
      const set = linesOfQuay.get(q) ?? new Set<string>();
      set.add(p.lineId);
      linesOfQuay.set(q, set);
    }
  }
  const quays: Record<string, Quay> = {};
  const stations: Record<string, Station> = {};
  const stationLines = new Map<string, Set<string>>();
  for (const id of [...usedQuays].sort()) {
    const s = byId.get(id);
    if (!s) continue;
    const stationId = s.parent_station ? stripIdfm(s.parent_station) : id;
    quays[id] = { id, name: s.stop_name, lon: Number(s.stop_lon), lat: Number(s.stop_lat), stationId };
    let st = stations[stationId];
    if (!st) {
      const parent = byId.get(stationId) ?? s;
      st = { id: stationId, name: parent.stop_name, lon: Number(parent.stop_lon), lat: Number(parent.stop_lat), quays: [], lines: [] };
      stations[stationId] = st;
      stationLines.set(stationId, new Set());
    }
    st.quays.push(id);
    for (const l of linesOfQuay.get(id) ?? []) stationLines.get(stationId)!.add(l);
  }
  for (const [id, set] of stationLines) stations[id].lines = [...set].sort();
  return { quays, stations };
}

/** Douglas-Peucker simplification with a tolerance in metres. */
export function simplifyLine(line: LngLat[], toleranceM: number): LngLat[] {
  if (line.length <= 2) return [...line];
  const keep = new Uint8Array(line.length);
  keep[0] = keep[line.length - 1] = 1;
  const stack: [number, number][] = [[0, line.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    let maxD = -1;
    let idx = -1;
    for (let k = i + 1; k < j; k++) {
      const d = projectOnLine([line[i], line[j]], line[k]).dist;
      if (d > maxD) [maxD, idx] = [d, k];
    }
    if (idx >= 0 && maxD > toleranceM) {
      keep[idx] = 1;
      stack.push([i, idx], [idx, j]);
    }
  }
  return line.filter((_, k) => keep[k]);
}

/**
 * A line's drawn trace, built from its own stop-to-stop segments (already checked against the stop
 * positions) instead of the raw GTFS shapes, some of which follow another line's tracks (e.g. Transilien L
 * shapes towards Saint-Lazare running through Colombes on the J tracks). Patterns are walked busiest
 * first; consecutive new segments are chained into one polyline and each station pair is drawn once.
 */
export function lineShapesFromSegments(
  patterns: Pattern[],
  segments: Record<string, Segment>,
  quays: Record<string, Quay>,
  lineId: string,
): LngLat[][] {
  const seen = new Set<string>();
  const out: LngLat[][] = [];
  const station = (q: string) => quays[q]?.stationId ?? q;
  for (const p of patterns.filter((x) => x.lineId === lineId).sort((a, b) => b.trips - a.trips)) {
    let current: LngLat[] | null = null;
    for (let i = 0; i + 1 < p.quays.length; i++) {
      const seg = segments[`${p.quays[i]}>${p.quays[i + 1]}`];
      const [s1, s2] = [station(p.quays[i]), station(p.quays[i + 1])];
      const pair = s1 < s2 ? `${s1}|${s2}` : `${s2}|${s1}`;
      if (!seg || seg.coords.length < 2 || seen.has(pair)) {
        current = null;
        continue;
      }
      seen.add(pair);
      if (current) current.push(...seg.coords.slice(1));
      else {
        current = [...seg.coords];
        out.push(current);
      }
    }
  }
  return out;
}
