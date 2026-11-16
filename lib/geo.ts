import type { LngLat } from './types';

const R = 6371008.8;
const rad = (d: number) => (d * Math.PI) / 180;

/** Haversine distance in metres. */
export function distanceM(a: LngLat, b: LngLat): number {
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Cumulative distance (m) at each vertex; cum[0] = 0. */
export function cumulativeLengths(line: LngLat[]): number[] {
  const cum: number[] = [];
  let total = 0;
  for (let i = 0; i < line.length; i++) {
    if (i > 0) total += distanceM(line[i - 1], line[i]);
    cum.push(total);
  }
  return cum;
}

const lerp = (a: LngLat, b: LngLat, t: number): LngLat => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** Closest point of the polyline to p: distance along the line (m) and distance to the line (m). */
export function projectOnLine(line: LngLat[], p: LngLat, cum?: number[]): { along: number; dist: number } {
  if (line.length === 0) return { along: 0, dist: Infinity };
  if (line.length === 1) return { along: 0, dist: distanceM(line[0], p) };
  const c = cum ?? cumulativeLengths(line);
  let best = { along: 0, dist: Infinity };
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i];
    const b = line[i + 1];
    // local equirectangular frame around the segment start
    const k = Math.cos(rad(a[1]));
    const bx = (b[0] - a[0]) * k;
    const by = b[1] - a[1];
    const px = (p[0] - a[0]) * k;
    const py = p[1] - a[1];
    const len2 = bx * bx + by * by;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / len2));
    const q = lerp(a, b, t);
    const dist = distanceM(q, p);
    if (dist < best.dist) best = { along: c[i] + t * (c[i + 1] - c[i]), dist };
  }
  return best;
}

function pointAtAlong(line: LngLat[], cum: number[], along: number): LngLat {
  const total = cum[cum.length - 1];
  if (along <= 0) return line[0];
  if (along >= total) return line[line.length - 1];
  let i = 1;
  while (i < cum.length - 1 && cum[i] < along) i++;
  const seg = cum[i] - cum[i - 1];
  return lerp(line[i - 1], line[i], seg === 0 ? 0 : (along - cum[i - 1]) / seg);
}

/** Portion of the line between two distances along it; reversed when from > to. */
export function sliceLine(line: LngLat[], fromAlong: number, toAlong: number): LngLat[] {
  if (line.length === 0) return [];
  if (fromAlong > toAlong) return sliceLine(line, toAlong, fromAlong).reverse();
  const cum = cumulativeLengths(line);
  const total = cum[cum.length - 1];
  const from = Math.max(0, Math.min(total, fromAlong));
  const to = Math.max(0, Math.min(total, toAlong));
  const out: LngLat[] = [pointAtAlong(line, cum, from)];
  for (let i = 0; i < line.length; i++) {
    if (cum[i] > from && cum[i] < to) out.push(line[i]);
  }
  out.push(pointAtAlong(line, cum, to));
  return out;
}

/** Point at fraction f (clamped to [0,1]) of the line's length. */
export function pointAtFraction(line: LngLat[], f: number): LngLat {
  if (line.length === 0) throw new Error('empty line');
  if (line.length === 1) return line[0];
  const cum = cumulativeLengths(line);
  const fc = Math.max(0, Math.min(1, f));
  return pointAtAlong(line, cum, fc * cum[cum.length - 1]);
}
