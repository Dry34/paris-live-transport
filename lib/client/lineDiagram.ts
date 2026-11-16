import type { Network, VehicleRun } from '../types';
import { positionAt } from './interpolate';

export interface DiagramBranch { directionId: 0 | 1; headsign: string; stations: string[] }
export interface DiagramPlacement { runId: string; afterIndex: number; fraction: number }

function isSubsequence(small: string[], big: string[]): boolean {
  let i = 0;
  for (const s of big) if (s === small[i]) i++;
  return i === small.length;
}

/** Per direction, patterns by decreasing trip count, dropping any that is a subsequence of one already kept. */
export function diagramBranches(network: Network, lineId: string): DiagramBranch[] {
  const out: DiagramBranch[] = [];
  for (const directionId of [0, 1] as const) {
    const kept: string[][] = [];
    const patterns = network.patterns
      .filter((p) => p.lineId === lineId && p.directionId === directionId)
      .sort((a, b) => b.trips - a.trips);
    for (const p of patterns) {
      const stations: string[] = [];
      for (const q of p.quays) {
        const st = network.quays[q]?.stationId;
        if (st && stations[stations.length - 1] !== st) stations.push(st);
      }
      if (stations.length === 0 || kept.some((k) => isSubsequence(stations, k))) continue;
      kept.push(stations);
      out.push({ directionId, headsign: p.headsign, stations });
    }
  }
  return out;
}

/** Position of each run on the branch: between station `afterIndex` and the next, `fraction` of the way. Runs off the branch are skipped. */
export function placeRunsOnDiagram(branch: DiagramBranch, runs: VehicleRun[], network: Network, now: number): DiagramPlacement[] {
  const out: DiagramPlacement[] = [];
  const stationOf = (quay: string) => network.quays[quay]?.stationId;
  for (const run of runs) {
    const pos = positionAt(run, network, now);
    if (!pos) continue;
    if (pos.state === 'moving' && pos.segmentKey) {
      const [from, to] = pos.segmentKey.split('>');
      const a = stationOf(from);
      const b = stationOf(to);
      const i = branch.stations.findIndex((s, k) => s === a && branch.stations[k + 1] === b);
      if (i >= 0) out.push({ runId: run.id, afterIndex: i, fraction: pos.fraction });
    } else if (pos.nextQuay) {
      const i = branch.stations.indexOf(stationOf(pos.nextQuay) ?? '');
      if (i >= 0) out.push({ runId: run.id, afterIndex: i, fraction: 0 });
    }
  }
  return out;
}
