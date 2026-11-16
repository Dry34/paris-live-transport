// Next departures at a station, grouped by "lineId|direction".
import type { Departure, Network, Snapshot } from '../types';

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
    for (const stop of run.stops) {
      const time = stop.dep ?? stop.arr;
      if (!quays.has(stop.quay) || time === null || time <= now) continue;
      const key = `${run.lineId}|${run.direction}`;
      (out[key] ??= []).push({ lineId: run.lineId, destination: run.destination, direction: run.direction, time, runId: run.id });
    }
  }
  for (const key of Object.keys(out)) out[key] = out[key].sort((a, b) => a.time - b.time).slice(0, limit);
  return out;
}
