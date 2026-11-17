import type { LngLat, Mode, Network, RunStop, Segment, VehicleRun } from '../types';
import { bearingAtFraction, cumulativeLengths, distanceM, pointAtFraction } from '../geo';

export type RunPosition = {
  coord: LngLat;
  state: 'moving' | 'dwelling' | 'waiting';
  segmentKey: string | null;
  fraction: number;
  nextQuay: string | null;
  nextTime: number | null;
  /** Direction of travel in degrees (0 = north, clockwise), or null when unknown. */
  bearing: number | null;
};

const GRACE_AFTER_END_MS = 60_000;
/**
 * A train waiting at its previous station is only drawn this long before it is due to leave: an inferred
 * previous station is a guess, and the train is really still several stations away.
 */
export const PREVIOUS_WAIT_MS = 60_000;
/** A train waiting at its first stop (terminus, no previous station) is only drawn this long before departure. */
export const TERMINUS_WAIT_MS = 10 * 60_000;

/**
 * Fastest plausible average speed (km/h) between two stops, per mode. A train whose section would need more
 * is hidden until its position is consistent again, rather than drawn racing across the map.
 */
export const MAX_SPEED_KMH: Record<Mode, number> = { metro: 100, tram: 90, rer: 180, transilien: 180 };

const segmentLengths = new WeakMap<Segment, number>();
/** Length (m) of a segment's polyline, computed once per segment object. */
function segmentLength(seg: Segment): number {
  let len = segmentLengths.get(seg);
  if (len === undefined) {
    len = seg.coords.length < 2 ? 0 : cumulativeLengths(seg.coords)[seg.coords.length - 1];
    segmentLengths.set(seg, len);
  }
  return len;
}

const arrOf = (s: RunStop): number | null => s.arr ?? s.dep;
const depOf = (s: RunStop): number | null => s.dep ?? s.arr;

/**
 * Stop time (ms) given to a train at an intermediate station the feed gives no dwell for (RATP metro
 * calls carry the same arrival and departure time), so trains visibly stop instead of gliding through.
 */
export const MIN_DWELL_MS: Record<Mode, number> = { metro: 20_000, tram: 20_000, rer: 30_000, transilien: 30_000 };

/** Spreads a zero dwell around the feed time, never over more than a third of the adjoining sections. */
function withDwells(stops: RunStop[], mode: Mode | undefined): RunStop[] {
  if (!mode || stops.length < 3) return stops;
  let out: RunStop[] | null = null;
  for (let i = 1; i < stops.length - 1; i++) {
    const s = stops[i];
    const t = arrOf(s);
    const d = depOf(s);
    if (t === null || d === null || d > t) continue;
    const prev = depOf(stops[i - 1]);
    const next = arrOf(stops[i + 1]);
    if (prev === null || next === null) continue;
    const half = Math.min(MIN_DWELL_MS[mode] / 2, (t - prev) / 3, (next - t) / 3);
    if (!(half > 0)) continue;
    out ??= [...stops];
    out[i] = { ...s, arr: t - half, dep: t + half };
  }
  return out ?? stops;
}

export function positionAt(run: VehicleRun, network: Network, now: number): RunPosition | null {
  if (run.stops.length === 0 || run.hide === 'always') return null;
  const mode = network.lines?.[run.lineId]?.mode;
  const stops = withDwells(run.stops, mode);

  const sectionBearing = (from: number, to: number, f: 0 | 1): number | null => {
    if (from < 0 || to >= stops.length) return null;
    const seg = network.segments[`${stops[from].quay}>${stops[to].quay}`];
    return seg ? bearingAtFraction(seg.coords, f) : null;
  };
  const atQuay = (i: number, state: 'dwelling' | 'waiting', nextTime: number | null): RunPosition | null => {
    const q = network.quays[stops[i].quay];
    if (!q) return null;
    // Heading: the section it is about to run, else the one it arrived on.
    const bearing = sectionBearing(i, i + 1, 0) ?? sectionBearing(i - 1, i, 1);
    return { coord: [q.lon, q.lat], state, segmentKey: null, fraction: 0, nextQuay: stops[i].quay, nextTime, bearing };
  };

  const firstDep = depOf(stops[0]);
  if (firstDep === null) return null;
  if (now < firstDep) {
    // Hide rather than park a train for a long time where it may not be: an inferred previous station is
    // a guess (the train is really several stations away), and SIRI lists terminus departures hours ahead.
    if (run.hide === 'whileWaiting') return null;
    if (run.hasPrevious && firstDep - now > PREVIOUS_WAIT_MS) return null;
    if (!run.hasPrevious && firstDep - now > TERMINUS_WAIT_MS) return null;
    return atQuay(0, 'waiting', firstDep);
  }

  for (let i = 0; i < stops.length; i++) {
    const arr = arrOf(stops[i]);
    const dep = depOf(stops[i]);
    if (arr === null || dep === null) return null;
    if (i > 0 && now >= arr && now < dep) return atQuay(i, 'dwelling', dep);
    if (i === stops.length - 1) {
      if (now > arr + GRACE_AFTER_END_MS) return null;
      return atQuay(i, 'dwelling', null);
    }
    const next = stops[i + 1];
    const nextArr = arrOf(next);
    if (nextArr === null) return null;
    if (now >= dep && now < nextArr) {
      const segmentKey = `${stops[i].quay}>${next.quay}`;
      const seg = network.segments[segmentKey];
      if (!seg || seg.coords.length === 0 || !network.quays[stops[i].quay] || !network.quays[next.quay]) return null;
      const span = nextArr - dep;
      const cap = mode ? MAX_SPEED_KMH[mode] : undefined;
      if (cap !== undefined && span > 0 && (segmentLength(seg) / (span / 1000)) * 3.6 > cap) return null;
      const fraction = span > 0 ? Math.min(1, Math.max(0, (now - dep) / span)) : 1;
      return {
        coord: pointAtFraction(seg.coords, fraction),
        state: 'moving',
        segmentKey,
        fraction,
        nextQuay: next.quay,
        nextTime: nextArr,
        bearing: bearingAtFraction(seg.coords, fraction),
      };
    }
  }
  return null;
}

/** Longest time a train is held in place while a fresher estimate puts it behind where it is shown. */
export const MAX_HOLD_MS = 150_000;

/** Position along the run's stop list: stop index, plus the fraction of the section when moving; null if off the run. */
function progressOf(run: VehicleRun, p: RunPosition): number | null {
  const quay = p.segmentKey !== null ? p.segmentKey.slice(0, p.segmentKey.indexOf('>')) : p.nextQuay;
  const i = run.stops.findIndex((s) => s.quay === quay);
  if (i < 0) return null;
  return p.segmentKey !== null ? i + Math.min(p.fraction, 0.999) : i;
}

/** A train that would jump further than this (m) in one step disappears and reappears at its new place. */
export const JUMP_HIDE_M = 150;
/** How long such a train stays hidden (ms). */
export const REAPPEAR_MS = 1500;

/**
 * Keeps trains from teleporting when a fresher snapshot moves their estimate:
 * - put behind where it is shown (running late): the train stays where it is (at a station, it waits there)
 *   until the new estimate catches up, for at most MAX_HOLD_MS; after that, or if the shown position is no
 *   longer on the run, it takes the fresh position;
 * - put far ahead (> JUMP_HIDE_M): it disappears for REAPPEAR_MS and reappears at the right place, instead of
 *   sliding or racing there. `keepVisible` (the selected train, whose card must stay open) skips the hiding.
 */
export function createSmoother(): (run: VehicleRun, p: RunPosition | null, now: number, keepVisible?: boolean) => RunPosition | null {
  const last = new Map<string, { pos: RunPosition; heldSince: number | null; hiddenUntil: number }>();
  return (run, p, now, keepVisible = false) => {
    if (!p) {
      last.delete(run.id);
      return null;
    }
    const prev = last.get(run.id);
    if (prev) {
      if (now < prev.hiddenUntil && !keepVisible) {
        prev.pos = p;
        return null;
      }
      const shown = progressOf(run, prev.pos);
      const fresh = progressOf(run, p);
      if (shown !== null && fresh !== null && fresh < shown) {
        prev.heldSince ??= now;
        if (now - prev.heldSince <= MAX_HOLD_MS) return prev.pos;
      }
      if (!keepVisible && now >= prev.hiddenUntil && distanceM(prev.pos.coord, p.coord) > JUMP_HIDE_M) {
        last.set(run.id, { pos: p, heldSince: null, hiddenUntil: now + REAPPEAR_MS });
        return null;
      }
    }
    last.set(run.id, { pos: p, heldSince: null, hiddenUntil: 0 });
    return p;
  };
}
