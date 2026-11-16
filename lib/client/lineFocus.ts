import type { Disruption, LngLat, Mode, Network, VehicleRun } from '../types';
import { positionAt } from './interpolate';

export interface FocusBranch {
  directionId: 0 | 1;
  terminusStationId: string;
  terminusName: string;
  stations: string[];
  trips: number;
}

/** A terminus must carry at least this share of a direction's trips to become a branch. */
const MIN_BRANCH_SHARE = 0.05;
/** A train due within this delay is shown "à quai". */
const AT_PLATFORM_MS = 30_000;

const stationOfQuay = (network: Network, quay: string): string | null => network.quays[quay]?.stationId ?? null;

export function lineBranches(network: Network, lineId: string): FocusBranch[] {
  const out: FocusBranch[] = [];
  for (const directionId of [0, 1] as const) {
    const pats = network.patterns.filter((p) => p.lineId === lineId && p.directionId === directionId && p.quays.length > 0);
    const total = pats.reduce((n, p) => n + p.trips, 0);
    if (total === 0) continue;
    const byTerminus = new Map<string, { trips: number; best: (typeof pats)[number] }>();
    for (const p of pats) {
      const terminus = stationOfQuay(network, p.quays[p.quays.length - 1]);
      if (!terminus) continue;
      const g = byTerminus.get(terminus);
      if (!g) byTerminus.set(terminus, { trips: p.trips, best: p });
      else {
        g.trips += p.trips;
        if (p.trips > g.best.trips) g.best = p;
      }
    }
    for (const [terminusStationId, g] of byTerminus) {
      if (g.trips / total < MIN_BRANCH_SHARE) continue;
      const stations: string[] = [];
      for (const q of g.best.quays) {
        const s = stationOfQuay(network, q);
        if (s && stations[stations.length - 1] !== s) stations.push(s);
      }
      out.push({
        directionId,
        terminusStationId,
        terminusName: network.stations[terminusStationId]?.name ?? terminusStationId,
        stations,
        trips: g.trips,
      });
    }
  }
  return out.sort((a, b) => a.directionId - b.directionId || b.trips - a.trips);
}

/** "vers A / B": the two main termini of a direction (one if only one). */
export function directionLabel(branches: FocusBranch[], directionId: 0 | 1): string {
  const names = branches.filter((b) => b.directionId === directionId).slice(0, 2).map((b) => b.terminusName);
  return names.length ? `vers ${names.join(' / ')}` : '';
}

export interface StationArrival { seconds: number | null; atPlatform: boolean }

/**
 * Does the run, stopping at index k (a quay of branch.stations[i]), travel along the branch?
 * Yes when it goes on to the next branch station, or ends there coming from the previous one at the
 * branch terminus. A run going on to a station outside the branch (it left for a sibling branch) also
 * counts before the terminus, unless it comes from the next branch station (the opposite direction).
 */
function alongBranch(run: VehicleRun, k: number, i: number, branch: FocusBranch, network: Network): boolean {
  const st = (idx: number) => (run.stops[idx] ? stationOfQuay(network, run.stops[idx].quay) : null);
  const last = branch.stations.length - 1;
  const next = st(k + 1);
  if (next !== null) {
    if (i < last && next === branch.stations[i + 1]) return true;
    if (i < last && !branch.stations.includes(next)) return st(k - 1) !== branch.stations[i + 1];
    return false;
  }
  return k === run.stops.length - 1 && i === last && i > 0 && st(k - 1) === branch.stations[i - 1];
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
      if (!alongBranch(run, k, i, branch, network)) return;
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
