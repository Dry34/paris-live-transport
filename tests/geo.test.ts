import { describe, it, expect } from 'vitest';
import type { LngLat } from '../lib/types';
import { distanceM, cumulativeLengths, projectOnLine, sliceLine, pointAtFraction } from '../lib/geo';

const L: LngLat[] = [[0, 0], [0, 0.01], [0.01, 0.01]];

describe('geo', () => {
  it('distanceM haversine', () => {
    expect(distanceM([2.35, 48.85], [2.36, 48.85])).toBeCloseTo(732, -1);
    expect(Math.abs(distanceM([2.35, 48.85], [2.36, 48.85]) - 732)).toBeLessThan(5);
    expect(distanceM([1, 1], [1, 1])).toBe(0);
  });
  it('cumulativeLengths', () => {
    const c = cumulativeLengths(L);
    expect(c[0]).toBe(0);
    expect(Math.abs(c[1] - 1112)).toBeLessThan(5);
    expect(Math.abs(c[2] - 2224)).toBeLessThan(10);
  });
  it('projectOnLine', () => {
    const r = projectOnLine(L, [0.0001, 0.005]);
    expect(Math.abs(r.along - 556)).toBeLessThan(5);
    expect(Math.abs(r.dist - 11)).toBeLessThan(2);
    const r2 = projectOnLine(L, [0.0001, 0.005], cumulativeLengths(L));
    expect(r2.along).toBeCloseTo(r.along, 6);
  });
  it('projectOnLine clamps to ends and handles single point', () => {
    expect(projectOnLine(L, [0, -0.01]).along).toBe(0);
    expect(projectOnLine([[1, 1]], [1, 1.001]).along).toBe(0);
  });
  it('sliceLine', () => {
    const s = sliceLine(L, 556, 1668);
    expect(distanceM(s[0], [0, 0.005])).toBeLessThan(5);
    expect(s.some((p) => p[0] === 0 && p[1] === 0.01)).toBe(true);
    expect(distanceM(s[s.length - 1], [0.005, 0.01])).toBeLessThan(5);
    const r = sliceLine(L, 1668, 556);
    expect(r).toEqual([...s].reverse());
  });
  it('pointAtFraction', () => {
    const m = pointAtFraction(L, 0.5);
    expect(distanceM(m, [0, 0.01])).toBeLessThan(2);
    expect(pointAtFraction(L, -1)).toEqual([0, 0]);
    expect(pointAtFraction(L, 2)).toEqual([0.01, 0.01]);
    expect(pointAtFraction([[3, 4]], 0.5)).toEqual([3, 4]);
  });
});

import { bearingDeg, bearingAtFraction } from '../lib/geo';
describe('bearing', () => {
  it('bearingDeg: north 0, east 90, south 180, west 270', () => {
    expect(bearingDeg([2.35, 48.85], [2.35, 48.86])).toBeCloseTo(0, 0);
    expect(bearingDeg([2.35, 48.85], [2.36, 48.85])).toBeCloseTo(90, 0);
    expect(bearingDeg([2.35, 48.86], [2.35, 48.85])).toBeCloseTo(180, 0);
    expect(bearingDeg([2.36, 48.85], [2.35, 48.85])).toBeCloseTo(270, 0);
  });
  it('bearingAtFraction follows the local direction of an L-shaped line', () => {
    const L: [number, number][] = [[0, 0], [0, 0.01], [0.01, 0.01]];
    expect(bearingAtFraction(L, 0.25)).toBeCloseTo(0, 0);
    expect(bearingAtFraction(L, 0.75)).toBeCloseTo(90, 0);
    expect(bearingAtFraction(L, 0)).toBeCloseTo(0, 0);
    expect(bearingAtFraction(L, 1)).toBeCloseTo(90, 0);
  });
  it('bearingAtFraction is null for degenerate lines', () => {
    expect(bearingAtFraction([], 0.5)).toBeNull();
    expect(bearingAtFraction([[1, 1]], 0.5)).toBeNull();
    expect(bearingAtFraction([[1, 1], [1, 1]], 0.5)).toBeNull();
  });
});
