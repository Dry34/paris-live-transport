import type { LineInfo, Network } from './types';

/** URL slug of a line: m1, m7b, rer-b, t3a, j, l. */
export function lineSlug(line: Pick<LineInfo, 'shortName' | 'mode'>): string {
  const s = line.shortName.toLowerCase();
  if (line.mode === 'metro') return `m${s}`;
  if (line.mode === 'rer') return `rer-${s}`;
  return s;
}

/** Resolves a slug (`rer-b`) or an IDFM id (`C01742`, any case) to a line id, or null. */
export function resolveLineId(network: Pick<Network, 'lines'>, param: string): string | null {
  const wanted = param.toLowerCase();
  for (const line of Object.values(network.lines)) {
    if (line.id.toLowerCase() === wanted || lineSlug(line) === wanted) return line.id;
  }
  return null;
}
