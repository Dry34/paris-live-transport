import type { Disruption, LngLat, Mode, Network, VehicleRun } from '../types';
import { positionAt } from './interpolate';

export interface FocusBranch {
  directionId: 0 | 1;
  originStationId: string;
  originName: string;
  terminusStationId: string;
  terminusName: string;
  stations: string[];
  trips: number;
}

/** An origin/terminus pair must carry at least this share of a direction's trips to become a branch. */
const MIN_BRANCH_SHARE = 0.05;
/** A train due within this delay is shown "à quai". */
const AT_PLATFORM_MS = 30_000;

const stationOfQuay = (network: Network, quay: string): string | null => network.quays[quay]?.stationId ?? null;

const stationList = (network: Network, quays: string[]): string[] => {
  const stations: string[] = [];
  for (const q of quays) {
    const s = stationOfQuay(network, q);
    if (s && stations[stations.length - 1] !== s) stations.push(s);
  }
  return stations;
};

/**
 * Relative order of two station lists: same (0) or opposite (1) direction, judged on the stations they share
 * (first occurrences), with the number of shared stations. null when they share < 2 stations or the order is a tie.
 */
function relation(a: string[], b: string[]): { parity: 0 | 1; shared: number } | null {
  const posB = new Map<string, number>();
  b.forEach((s, i) => { if (!posB.has(s)) posB.set(s, i); });
  const seen = new Set<string>();
  const positions: number[] = [];
  for (const s of a) {
    if (seen.has(s)) continue;
    seen.add(s);
    const j = posB.get(s);
    if (j !== undefined) positions.push(j);
  }
  if (positions.length < 2) return null;
  let up = 0, down = 0;
  for (let i = 1; i < positions.length; i++) {
    if (positions[i] > positions[i - 1]) up++;
    else down++;
  }
  if (up === down) return null;
  return { parity: up > down ? 0 : 1, shared: positions.length };
}

/**
 * Splits a line's patterns into two directions from the order of their stations: GTFS direction_id mixes directions
 * on some lines (RER A, C, D). Starting from the most frequent pattern, each pattern is placed relative to the placed
 * pattern it shares the most stations with; a pattern sharing < 2 stations with every placed one falls back to its
 * GTFS directionId relative to the seed's. The group of the most frequent GTFS-direction-0 pattern becomes direction 0.
 */
function orderedDirections(pats: { directionId: 0 | 1; stations: string[]; trips: number }[]): (0 | 1)[] {
  const n = pats.length;
  const order = [...pats.keys()].sort((x, y) => pats[y].trips - pats[x].trips);
  const rel = pats.map((p, i) => pats.map((q, j) => (i === j ? null : relation(p.stations, q.stations))));
  const parity: (0 | 1 | undefined)[] = new Array(n).fill(undefined);
  const best: ({ parity: 0 | 1; shared: number } | null)[] = new Array(n).fill(null);
  const seed = order[0];
  const place = (i: number, par: 0 | 1) => {
    parity[i] = par;
    for (let j = 0; j < n; j++) {
      const r = rel[i][j];
      if (parity[j] !== undefined || !r) continue;
      if (!best[j] || r.shared > best[j]!.shared) best[j] = { parity: (par ^ r.parity) as 0 | 1, shared: r.shared };
    }
  };
  place(seed, 0);
  for (let placed = 1; placed < n; placed++) {
    let next = -1;
    for (const j of order) if (parity[j] === undefined && best[j] && (next < 0 || best[j]!.shared > best[next]!.shared)) next = j;
    if (next >= 0) place(next, best[next]!.parity);
    else {
      const j = order.find((k) => parity[k] === undefined)!;
      place(j, pats[j].directionId === pats[seed].directionId ? 0 : 1);
    }
  }
  const anchor = order.find((i) => pats[i].directionId === 0) ?? seed;
  const flip = pats[anchor].directionId === 0 ? parity[anchor]! : (parity[anchor]! ^ 1);
  return parity.map((p) => (p! ^ flip) as 0 | 1);
}

const isSubsequence = (short: string[], long: string[]): boolean => {
  let i = 0;
  for (const s of long) if (i < short.length && s === short[i]) i++;
  return i === short.length;
};

/**
 * Branches of a line: directions derived from station order, then one branch per (origin, terminus) pair carrying
 * ≥ 5 % of its direction's trips, minus short workings whose stations are a subsequence of a bigger branch.
 */
export function lineBranches(network: Network, lineId: string): FocusBranch[] {
  const pats = network.patterns
    .filter((p) => p.lineId === lineId && p.trips > 0)
    .map((p) => ({ directionId: p.directionId, trips: p.trips, stations: stationList(network, p.quays) }))
    .filter((p) => p.stations.length > 0);
  if (pats.length === 0) return [];
  const dirs = orderedDirections(pats);
  const name = (id: string) => network.stations[id]?.name ?? id;
  const out: FocusBranch[] = [];
  for (const directionId of [0, 1] as const) {
    const group = pats.filter((_, i) => dirs[i] === directionId);
    const total = group.reduce((n, p) => n + p.trips, 0);
    const byKey = new Map<string, { trips: number; best: (typeof pats)[number] }>();
    for (const p of group) {
      const key = `${p.stations[0]}>${p.stations[p.stations.length - 1]}`;
      const g = byKey.get(key);
      if (!g) byKey.set(key, { trips: p.trips, best: p });
      else {
        g.trips += p.trips;
        if (p.trips > g.best.trips) g.best = p;
      }
    }
    const candidates = [...byKey.values()].filter((g) => g.trips / total >= MIN_BRANCH_SHARE).sort((a, b) => b.trips - a.trips);
    const kept: FocusBranch[] = [];
    for (const g of candidates) {
      const stations = g.best.stations;
      if (kept.some((k) => isSubsequence(stations, k.stations))) continue;
      const originStationId = stations[0];
      const terminusStationId = stations[stations.length - 1];
      kept.push({
        directionId,
        originStationId,
        originName: name(originStationId),
        terminusStationId,
        terminusName: name(terminusStationId),
        stations,
        trips: g.trips,
      });
    }
    out.push(...kept);
  }
  return out.sort((a, b) => a.directionId - b.directionId || b.trips - a.trips);
}

/** Chip label of a branch among its direction's branches: by origin when they converge, by terminus when they diverge. */
export function branchLabel(branch: FocusBranch, siblings: FocusBranch[]): string {
  if (siblings.every((b) => b.terminusStationId === branch.terminusStationId)) return `depuis ${branch.originName}`;
  if (siblings.every((b) => b.originStationId === branch.originStationId)) return `vers ${branch.terminusName}`;
  return `${branch.originName} → ${branch.terminusName}`;
}

/** "vers A / B": the two main termini of a direction by aggregated trips (one if only one). */
export function directionLabel(branches: FocusBranch[], directionId: 0 | 1): string {
  const trips = new Map<string, number>();
  for (const b of branches) if (b.directionId === directionId) trips.set(b.terminusName, (trips.get(b.terminusName) ?? 0) + b.trips);
  const names = [...trips].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([n]) => n);
  return names.length ? `vers ${names.join(' / ')}` : '';
}

export interface StationArrival { seconds: number | null; atPlatform: boolean }

const normName = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Does the run, stopping at index k (a quay of branch.stations[i]), travel along the branch?
 * The ET feed truncates runs (often just [previous, next]), so a run's last listed stop is rarely its terminus.
 * - With a following stop: yes when it is a later branch station (j > i, which also covers express runs that skip
 *   stations), or a station outside the branch (it leaves for a sibling branch) unless the run comes from a later
 *   branch station (the opposite direction).
 * - As the run's last listed stop: yes when the previous stop is an earlier branch station.
 * - As the run's only stop (a train waiting at its origin): yes at the branch origin or when the run's destination
 *   is the branch terminus.
 */
function alongBranch(run: VehicleRun, k: number, i: number, branch: FocusBranch, network: Network, index: Map<string, number>): boolean {
  const idx = (n: number) => {
    const stop = run.stops[n];
    if (!stop) return { exists: false, j: undefined };
    const s = stationOfQuay(network, stop.quay);
    return { exists: true, j: s === null ? undefined : index.get(s) };
  };
  const next = idx(k + 1);
  const prev = idx(k - 1);
  if (next.exists) {
    if (next.j !== undefined) return next.j > i;
    return i < branch.stations.length - 1 && !(prev.j !== undefined && prev.j > i);
  }
  if (prev.exists) return prev.j !== undefined && prev.j < i;
  return i === 0 || (run.destination !== '' && normName(run.destination) === normName(branch.terminusName));
}

/** `runs` must already be limited to the focused line: a branch carries no lineId, so other lines' runs would pollute the times. */
export function nextArrivalsAlongBranch(
  branch: FocusBranch,
  runs: VehicleRun[],
  network: Network,
  now: number,
): Record<string, StationArrival> {
  const result: Record<string, StationArrival> = {};
  branch.stations.forEach((s) => { result[s] = { seconds: null, atPlatform: false }; });
  const index = new Map(branch.stations.map((s, i) => [s, i] as const));

  for (const run of runs) {
    if (run.hide === 'always') continue;
    const pos = positionAt(run, network, now);
    run.stops.forEach((stop, k) => {
      const station = stationOfQuay(network, stop.quay);
      const i = station === null ? undefined : index.get(station);
      if (station === null || i === undefined) return;
      if (!alongBranch(run, k, i, branch, network, index)) return;
      const entry = result[station];
      if (pos && pos.state === 'dwelling' && pos.nextQuay === stop.quay) entry.atPlatform = true;
      if (k === 0 && run.prevInferred) return;
      const time = stop.arr ?? stop.dep;
      if (time === null || time <= now) return;
      const seconds = Math.round((time - now) / 1000);
      if (entry.seconds === null || seconds < entry.seconds) entry.seconds = seconds;
      if (time - now < AT_PLATFORM_MS) entry.atPlatform = true;
    });
  }
  return result;
}

const MODE_ORDER: Mode[] = ['metro', 'rer', 'tram', 'transilien'];

/** Other lines serving the station, ordered metro, rer, tram, transilien then naturally by short name. */
export function correspondences(network: Network, stationId: string, lineId: string): string[] {
  const lines = network.stations[stationId]?.lines ?? [];
  return lines
    .filter((id) => id !== lineId && network.lines[id])
    .sort((a, b) => {
      const la = network.lines[a];
      const lb = network.lines[b];
      return (
        MODE_ORDER.indexOf(la.mode) - MODE_ORDER.indexOf(lb.mode) ||
        la.shortName.localeCompare(lb.shortName, 'fr', { numeric: true })
      );
    });
}

export type LineStatus = 'ok' | 'disrupted' | 'no-service';

export function lineStatus(lineId: string, disruptions: Disruption[], runs: VehicleRun[], now: number): LineStatus {
  const disrupted = disruptions.some(
    (d) => d.lineIds.includes(lineId) && d.periods.some((p) => p.begin <= now && now <= p.end),
  );
  if (disrupted) return 'disrupted';
  return runs.some((r) => r.lineId === lineId && r.hide !== 'always') ? 'ok' : 'no-service';
}

export function lineBounds(network: Network, lineId: string): [LngLat, LngLat] | null {
  const shapes = network.lines[lineId]?.shapes ?? [];
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const shape of shapes) {
    for (const [lon, lat] of shape) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  return Number.isFinite(minLon) ? [[minLon, minLat], [maxLon, maxLat]] : null;
}

/**
 * `color` seen at `alpha` over `background`, as one opaque hex color. Fading lines with a blended color rather than
 * line-opacity keeps them faint where a line's many overlapping shapes would otherwise stack up their opacity.
 */
export function fadeColor(color: string, background: string, alpha: number): string {
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [c, b] = [rgb(color), rgb(background)];
  return '#' + c.map((v, i) => Math.round(v * alpha + b[i] * (1 - alpha)).toString(16).padStart(2, '0')).join('');
}
