// Builds VehicleRuns from SIRI journeys: matches the previous snapshot, finds each run's previous station.
import type { Journey, Network, Pattern, RunStop, VehicleRun } from '../types';

const MATCH_WINDOW_MS = 120_000;
const FUTURE_LIMIT_MS = 30 * 60_000;

const at = (s: { arr: number | null; dep: number | null }): number => (s.arr ?? s.dep)!;

interface Match { prev: VehicleRun; index: number } // index of calls[0].quay in prev.stops

/** Pairs journeys to previous runs (each previous run used once), closest in time first. */
function matchPrevious(journeys: Journey[], previous: VehicleRun[]): (Match | null)[] {
  const byId = new Map(previous.map((r) => [r.id, r]));
  const candidates: { j: number; p: number; index: number; diff: number }[] = [];
  journeys.forEach((jr, j) => {
    const q0 = jr.calls[0];
    if (jr.operator === 'SNCF') {
      const prev = byId.get(jr.ref);
      if (jr.ref && prev) candidates.push({ j, p: previous.indexOf(prev), index: prev.stops.findIndex((s) => s.quay === q0.quay), diff: 0 });
      return;
    }
    previous.forEach((prev, p) => {
      if (prev.lineId !== jr.lineId || prev.direction !== jr.direction || prev.destination !== jr.destination) return;
      prev.stops.forEach((s, index) => {
        if (s.quay !== q0.quay) return;
        const diff = Math.abs(at(s) - at(q0));
        if (diff <= MATCH_WINDOW_MS) candidates.push({ j, p, index, diff });
      });
    });
  });
  candidates.sort((a, b) => a.diff - b.diff);
  const out: (Match | null)[] = journeys.map(() => null);
  const used = new Set<number>();
  for (const c of candidates) {
    if (out[c.j] || used.has(c.p)) continue;
    out[c.j] = { prev: previous[c.p], index: c.index };
    used.add(c.p);
  }
  return out;
}

type Previous = { stop: RunStop | null; inferred: boolean } | 'reject';

/** Previous station inherited from the matched run: last stop that disappeared before calls[0]. */
function inheritedPrevious(m: Match): Exclude<Previous, 'reject'> | null {
  // index -1 happens for SNCF ref matches whose calls[0] is not among the previous stops: fall back to inference.
  if (m.index <= 0) return null;
  const firstCall = m.prev.hasPrevious ? 1 : 0;
  if (m.index > firstCall) return { stop: { ...m.prev.stops[m.index - 1] }, inferred: false };
  // Nothing disappeared: keep the previous run's own previous station as it was.
  return { stop: { ...m.prev.stops[0] }, inferred: m.prev.prevInferred };
}

/** Patterns grouped by lineId, computed once per network object. */
const patternIndex = new WeakMap<Network, Map<string, Pattern[]>>();
function patternsOf(net: Network, lineId: string): Pattern[] {
  let idx = patternIndex.get(net);
  if (!idx) {
    idx = new Map();
    for (const p of net.patterns) idx.set(p.lineId, [...(idx.get(p.lineId) ?? []), p]);
    patternIndex.set(net, idx);
  }
  return idx.get(lineId) ?? [];
}

/** Previous station inferred from the line's patterns (calls[0] at index > 0, followed by calls[1]). */
function inferredPrevious(jr: Journey, net: Network): Previous {
  const [c0, c1] = jr.calls;
  const preds: { quay: string; trips: number }[] = [];
  for (const p of patternsOf(net, jr.lineId)) {
    p.quays.forEach((q, i) => {
      if (i > 0 && q === c0.quay && (!c1 || p.quays[i + 1] === c1.quay)) preds.push({ quay: p.quays[i - 1], trips: p.trips });
    });
  }
  if (preds.length === 0) return { stop: null, inferred: false };
  preds.sort((a, b) => b.trips - a.trips);
  const pred = preds.find((p) => net.segments[`${p.quay}>${c0.quay}`]);
  if (!pred) return 'reject';
  const seconds = net.segments[`${pred.quay}>${c0.quay}`].seconds;
  return { stop: { quay: pred.quay, arr: null, dep: at(c0) - seconds * 1000 }, inferred: true };
}

function isTerminus(quay: string, lineId: string, net: Network): boolean {
  return patternsOf(net, lineId).some((p) => p.quays[0] === quay);
}

/**
 * Splits a journey wherever two consecutive calls are not a network segment. RATP SIRI journeys often
 * group passages of several trains (non-consecutive stations, times out of line order); each contiguous
 * piece becomes its own run so that every run only travels along real segments. Piece k > 0 gets ref
 * `ref#k` (empty ref stays empty and falls back to the composite id).
 */
function splitAtGaps(jr: Journey, net: Network): Journey[] {
  const pieces: Journey[] = [];
  let start = 0;
  for (let i = 1; i <= jr.calls.length; i++) {
    if (i < jr.calls.length && net.segments[`${jr.calls[i - 1].quay}>${jr.calls[i].quay}`]) continue;
    const k = pieces.length;
    pieces.push({ ...jr, ref: k === 0 || !jr.ref ? jr.ref : `${jr.ref}#${k}`, calls: jr.calls.slice(start, i) });
    start = i;
  }
  return pieces;
}

export function buildRuns(journeys: Journey[], network: Network, previous: VehicleRun[] | null, now: number): VehicleRun[] {
  // Rule 3 on the whole journey first: an unknown first quay drops it entirely; later pieces that
  // start on an unknown quay are dropped by the same check below.
  const usable = journeys
    .filter((j) => j.calls.length > 0 && network.quays[j.calls[0].quay])
    .flatMap((j) => splitAtGaps(j, network));
  const matches = matchPrevious(usable, previous ?? []);
  const runs: VehicleRun[] = [];
  const reserved = new Set(matches.flatMap((m) => (m ? [m.prev.id] : [])));
  const ids = new Set<string>();
  usable.forEach((jr, i) => {
    const c0 = jr.calls[0];
    if (!network.quays[c0.quay]) return;
    if (at(c0) > now + FUTURE_LIMIT_MS && !isTerminus(c0.quay, jr.lineId, network)) return;

    const m = matches[i];
    const prev = (m && inheritedPrevious(m)) ?? inferredPrevious(jr, network);
    if (prev === 'reject') return;
    if (prev.stop && !network.segments[`${prev.stop.quay}>${c0.quay}`]) return;

    // Matched ids are reserved up front so an unmatched journey cannot take a matched run's identity.
    const fallbackId = `${jr.lineId}:${jr.direction}:${c0.quay}:${at(c0)}`;
    let id = m ? m.prev.id : jr.ref || fallbackId;
    if (!m && reserved.has(id)) id = fallbackId;
    if (ids.has(id) || (!m && reserved.has(id))) {
      let n = 1;
      while (ids.has(`${fallbackId}#${n}`) || reserved.has(`${fallbackId}#${n}`)) n++;
      id = `${fallbackId}#${n}`;
    }
    ids.add(id);

    runs.push({
      id,
      lineId: jr.lineId,
      direction: jr.direction,
      destination: jr.destination,
      stops: [...(prev.stop ? [prev.stop] : []), ...jr.calls.map((c) => ({ ...c }))],
      hasPrevious: prev.stop !== null,
      prevInferred: prev.inferred,
    });
  });
  return runs;
}
