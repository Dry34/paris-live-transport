// Next departures at a station, grouped by "lineId|direction".
import type { Departure, Network, Snapshot } from '../types';

const COLLAPSE_MS = 30_000;

export function departuresForStation(
  snapshot: Snapshot,
  network: Network,
  stationId: string,
  now: number,
  limit = 4,
): Record<string, Departure[]> {
  const quays = new Set(network.stations[stationId]?.quays ?? []);
  const out: Record<string, Departure[]> = {};
  for (const run of snapshot.runs) {
    run.stops.forEach((stop, k) => {
      // stops[0] of a run with a previous station is a station already left (or an inferred one, not in SIRI).
      if (k === 0 && run.hasPrevious) return;
      // The last stop without departure time is an arrival at the terminus, not a departure.
      if (k === run.stops.length - 1 && stop.dep === null) return;
      const time = stop.dep ?? stop.arr;
      if (!quays.has(stop.quay) || time === null || time <= now) return;
      const key = `${run.lineId}|${run.direction}`;
      (out[key] ??= []).push({ lineId: run.lineId, destination: run.destination, direction: run.direction, time, runId: run.id });
    });
  }
  for (const key of Object.keys(out)) {
    const sorted = out[key].sort((a, b) => a.time - b.time);
    // Two passages less than 30 s apart on the same line and direction are the same train listed twice.
    const unique = sorted.filter((d, i) => i === 0 || d.time - sorted[i - 1].time >= COLLAPSE_MS);
    out[key] = unique.slice(0, limit);
  }
  return out;
}
