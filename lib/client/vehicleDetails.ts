import type { Network, Pattern, RunStop, VehicleRun } from '../types';
import { cumulativeLengths } from '../geo';
import { positionAt, type RunPosition } from './interpolate';
import { correspondences, normName } from './lineFocus';

export interface UpcomingStop {
  quay: string;
  stationId: string;
  name: string;
  /** Epoch ms. */
  time: number;
  /** true when computed from theoretical running times, beyond what the realtime feed gives. */
  estimated: boolean;
  correspondences: string[];
}

/** A known stop stays listed this long after its time (the train may still be at the platform). */
const PAST_GRACE_MS = 30_000;
/** Dwell assumed at each station when estimating times beyond the feed. */
const DWELL_MS = 20_000;

const timeOf = (s: RunStop): number | null => s.arr ?? s.dep;
const stationOf = (network: Network, quay: string): string | null => network.quays[quay]?.stationId ?? null;

/** Index in `long` of each element of `short` matched in order (greedy), or null when it is not a subsequence. */
function matchInOrder(short: string[], long: string[]): number[] | null {
  const at: number[] = [];
  let j = 0;
  for (const s of short) {
    while (j < long.length && long[j] !== s) j++;
    if (j === long.length) return null;
    at.push(j++);
  }
  return at;
}

/**
 * The line pattern continuing the run: one containing the run's known stations in order whose terminus is named
 * like the run's destination, else the most frequent one containing them. Returns the pattern and the index of the
 * run's last known station in it.
 */
function continuation(run: VehicleRun, network: Network): { pattern: Pattern; from: number } | null {
  const known: string[] = [];
  for (const stop of run.stops) {
    const st = stationOf(network, stop.quay);
    if (st && known[known.length - 1] !== st) known.push(st);
  }
  if (known.length === 0) return null;
  const dest = normName(run.destination);
  let best: { pattern: Pattern; from: number; named: boolean } | null = null;
  for (const pattern of network.patterns) {
    if (pattern.lineId !== run.lineId || pattern.trips <= 0) continue;
    const stations = pattern.quays.map((q) => stationOf(network, q) ?? '');
    const at = matchInOrder(known, stations);
    if (!at) continue;
    const terminus = network.stations[stations[stations.length - 1]]?.name ?? '';
    const named = dest !== '' && (normName(terminus) === dest || normName(pattern.headsign) === dest);
    if (!best || (named && !best.named) || (named === best.named && pattern.trips > best.pattern.trips)) {
      best = { pattern, from: at[at.length - 1], named };
    }
  }
  return best && { pattern: best.pattern, from: best.from };
}

/**
 * The run's coming stops, in order: the known ones (time ≥ now − 30 s; the previous station excluded), then the
 * rest of its pattern up to the terminus, estimated from theoretical running times + 20 s dwell per station.
 */
export function upcomingStops(run: VehicleRun, network: Network, now: number): UpcomingStop[] {
  const out: UpcomingStop[] = [];
  const push = (quay: string, time: number, estimated: boolean) => {
    const q = network.quays[quay];
    if (!q) return;
    const name = network.stations[q.stationId]?.name ?? q.name;
    out.push({ quay, stationId: q.stationId, name, time, estimated, correspondences: correspondences(network, q.stationId, run.lineId) });
  };

  run.stops.forEach((stop, k) => {
    if (k === 0 && run.hasPrevious) return;
    const time = timeOf(stop);
    if (time !== null && time >= now - PAST_GRACE_MS) push(stop.quay, time, false);
  });

  const last = run.stops[run.stops.length - 1];
  const cont = last && continuation(run, network);
  if (!last || !cont) return out;
  const lastArr = last.arr ?? last.dep;
  const lastDep = last.dep ?? (lastArr === null ? null : lastArr + DWELL_MS);
  if (lastDep === null) return out;
  let depart: number = lastDep;
  let prevQuay = last.quay;
  const quays = cont.pattern.quays;
  for (let i = cont.from + 1; i < quays.length; i++) {
    // The run may use another quay of the same station than the pattern: fall back to the pattern's section.
    const seg = network.segments[`${prevQuay}>${quays[i]}`] ?? network.segments[`${quays[i - 1]}>${quays[i]}`];
    if (!seg) break;
    const arrival = depart + seg.seconds * 1000;
    if (arrival >= now - PAST_GRACE_MS) push(quays[i], arrival, true);
    depart = arrival + DWELL_MS;
    prevQuay = quays[i];
  }
  return out;
}

/** "imminent" under a minute, else "N min"; estimated times get a "~" (and never read "imminent"). */
export function formatEta(time: number, now: number, estimated: boolean): string {
  const sec = (time - now) / 1000;
  if (sec < 60) return estimated ? '~1 min' : 'imminent';
  return `${estimated ? '~' : ''}${Math.floor(sec / 60)} min`;
}

/** Average speed over the section being run (km/h, rounded), or null when the train is not moving. */
export function estimatedSpeedKmh(run: VehicleRun, position: RunPosition, network: Network): number | null {
  if (position.state !== 'moving' || !position.segmentKey) return null;
  const seg = network.segments[position.segmentKey];
  if (!seg || seg.coords.length < 2) return null;
  const { stops } = run;
  for (let i = 0; i < stops.length - 1; i++) {
    if (`${stops[i].quay}>${stops[i + 1].quay}` !== position.segmentKey) continue;
    const dep = stops[i].dep ?? stops[i].arr;
    const arr = stops[i + 1].arr ?? stops[i + 1].dep;
    if (dep === null || arr === null || arr - dep <= 0) return null;
    const cum = cumulativeLengths(seg.coords);
    return Math.round((cum[cum.length - 1] / ((arr - dep) / 1000)) * 3.6);
  }
  return null;
}

/** Delay (s, expected − aimed) at the run's next stop, or null when unknown. */
export function currentDelaySec(run: VehicleRun, position: RunPosition): number | null {
  if (!position.nextQuay) return null;
  return run.stops.find((s) => s.quay === position.nextQuay)?.delaySec ?? null;
}

export function formatDelay(sec: number | null): { text: string; tone: 'late' | 'on-time' | 'early' } | null {
  if (sec === null) return null;
  if (sec >= 60) return { text: `+${Math.floor(sec / 60)} min`, tone: 'late' };
  if (sec <= -60) return { text: `−${Math.floor(-sec / 60)} min`, tone: 'early' };
  return { text: "à l'heure", tone: 'on-time' };
}

/** Real (non-inferred) stops of a run with a time, as [station, time]. */
function realTimes(run: VehicleRun, network: Network): [string, number][] {
  const out: [string, number][] = [];
  run.stops.forEach((stop, k) => {
    if (k === 0 && run.prevInferred) return;
    const st = stationOf(network, stop.quay);
    const time = timeOf(stop);
    if (st && time !== null) out.push([st, time]);
  });
  return out;
}

/**
 * Minutes to the trains of the same line and direction just ahead and just behind, compared at the run's next
 * station on real times only; null when there is none. Only trains currently on the map count: the feed keeps
 * runs whose last stop passed long ago, and their old times would read as a train far ahead.
 */
export function neighborGaps(
  run: VehicleRun,
  runs: VehicleRun[],
  network: Network,
  now: number,
): { aheadMin: number | null; behindMin: number | null } {
  const next = realTimes(run, network).find(([, t]) => t > now);
  if (!next) return { aheadMin: null, behindMin: null };
  const [station, time] = next;
  let ahead: number | null = null;
  let behind: number | null = null;
  for (const other of runs) {
    if (other.id === run.id || other.hide === 'always' || other.lineId !== run.lineId || other.direction !== run.direction) continue;
    if (!positionAt(other, network, now)) continue;
    for (const [st, t] of realTimes(other, network)) {
      if (st !== station) continue;
      if (t < time && (ahead === null || t > ahead)) ahead = t;
      if (t > time && (behind === null || t < behind)) behind = t;
    }
  }
  return {
    aheadMin: ahead === null ? null : Math.round((time - ahead) / 60_000),
    behindMin: behind === null ? null : Math.round((behind - time) / 60_000),
  };
}

/** Next stops listed before the fold on the card. */
const CARD_HEAD = 4;

/** Card layout of the coming stops: the 4 next ones, the folded ones between them and the terminus, the terminus. */
export function cardRows(stops: UpcomingStop[]): { head: UpcomingStop[]; hidden: UpcomingStop[]; terminus: UpcomingStop | null } {
  if (stops.length === 0) return { head: [], hidden: [], terminus: null };
  const terminus = stops[stops.length - 1];
  const before = stops.slice(0, -1);
  return { head: before.slice(0, CARD_HEAD), hidden: before.slice(CARD_HEAD), terminus };
}

/** "il y a N s" since the snapshot was fetched. */
export function dataAgeText(fetchedAt: number, now: number): string {
  return `il y a ${Math.max(0, Math.floor((now - fetchedAt) / 1000))} s`;
}

/** Gap to a neighbouring train in whole minutes ("4′"); under a minute reads "<1′" rather than "0′". */
export function gapText(min: number): string {
  return min < 1 ? '<1′' : `${min}′`;
}
