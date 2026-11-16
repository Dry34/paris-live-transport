import { describe, expect, it } from 'vitest';
import { cardRows, dataAgeText, type UpcomingStop } from '../lib/client/vehicleDetails';

const stop = (n: number): UpcomingStop => ({
  quay: `q${n}`,
  stationId: `S${n}`,
  name: `S${n}`,
  time: n * 60_000,
  estimated: false,
  correspondences: [],
});
const stops = (n: number) => Array.from({ length: n }, (_, i) => stop(i + 1));

describe('cardRows', () => {
  it('is empty without stops', () => {
    expect(cardRows([])).toEqual({ head: [], hidden: [], terminus: null });
  });

  it('shows everything when the four next stops and the terminus cover the list', () => {
    expect(cardRows(stops(1))).toEqual({ head: [], hidden: [], terminus: stop(1) });
    const five = cardRows(stops(5));
    expect(five.head.map((s) => s.quay)).toEqual(['q1', 'q2', 'q3', 'q4']);
    expect(five.hidden).toEqual([]);
    expect(five.terminus?.quay).toBe('q5');
  });

  it('folds the stops between the 4th and the terminus', () => {
    const r = cardRows(stops(16));
    expect(r.head.map((s) => s.quay)).toEqual(['q1', 'q2', 'q3', 'q4']);
    expect(r.hidden.map((s) => s.quay)).toEqual(['q5', 'q6', 'q7', 'q8', 'q9', 'q10', 'q11', 'q12', 'q13', 'q14', 'q15']);
    expect(r.terminus?.quay).toBe('q16');
  });
});

describe('dataAgeText', () => {
  it('reads whole seconds since the snapshot, never negative', () => {
    expect(dataAgeText(1_000, 40_400)).toBe('il y a 39 s');
    expect(dataAgeText(5_000, 4_000)).toBe('il y a 0 s');
  });
});
