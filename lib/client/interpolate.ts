import type { LngLat, Network, RunStop, VehicleRun } from '../types';
import { pointAtFraction } from '../geo';

export type RunPosition = {
  coord: LngLat;
  state: 'moving' | 'dwelling' | 'waiting';
  segmentKey: string | null;
  fraction: number;
  nextQuay: string | null;
  nextTime: number | null;
};

const GRACE_AFTER_END_MS = 60_000;
/**
 * A train waiting at its previous station is only drawn this long before it is due to leave: an inferred
 * previous station is a guess, and the train is really still several stations away.
 */
export const PREVIOUS_WAIT_MS = 60_000;
/** A train waiting at its first stop (terminus, no previous station) is only drawn this long before departure. */
export const TERMINUS_WAIT_MS = 10 * 60_000;

const arrOf = (s: RunStop): number | null => s.arr ?? s.dep;
const depOf = (s: RunStop): number | null => s.dep ?? s.arr;

export function positionAt(run: VehicleRun, network: Network, now: number): RunPosition | null {
  const { stops } = run;
  if (stops.length === 0 || run.hide === 'always') return null;

  const atQuay = (i: number, state: 'dwelling' | 'waiting', nextTime: number | null): RunPosition | null => {
    const q = network.quays[stops[i].quay];
    if (!q) return null;
    return { coord: [q.lon, q.lat], state, segmentKey: null, fraction: 0, nextQuay: stops[i].quay, nextTime };
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
      const fraction = span > 0 ? Math.min(1, Math.max(0, (now - dep) / span)) : 1;
      return {
        coord: pointAtFraction(seg.coords, fraction),
        state: 'moving',
        segmentKey,
        fraction,
        nextQuay: next.quay,
        nextTime: nextArr,
      };
    }
  }
  return null;
}

/** A small step back in the same section (a re-estimate), as opposed to a jump to a new section. */
export function isBackwardJitter(prevFraction: number, fraction: number): boolean {
  return fraction < prevFraction && prevFraction - fraction <= 0.5;
}

export function createSmoother(): (runId: string, p: RunPosition | null) => RunPosition | null {
  const last = new Map<string, RunPosition>();
  return (runId, p) => {
    if (!p) {
      last.delete(runId);
      return null;
    }
    const prev = last.get(runId);
    if (
      prev &&
      prev.segmentKey !== null &&
      prev.segmentKey === p.segmentKey &&
      isBackwardJitter(prev.fraction, p.fraction)
    ) {
      return prev;
    }
    last.set(runId, p);
    return p;
  };
}
