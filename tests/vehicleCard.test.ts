import { describe, expect, it } from 'vitest';
import { cardRows, dataAgeText, gapText, type UpcomingStop } from '../lib/client/vehicleDetails';
import { panIntoView, popupPadding } from '../lib/client/popupView';

const stop = (n: number): UpcomingStop => ({
  quay: `q${n}`,
  stationId: `S${n}`,
  atPlatform: false,
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

describe('gapText', () => {
  it('prints whole minutes, and "<1" instead of a zero gap', () => {
    expect(gapText(4)).toBe('4′');
    expect(gapText(0)).toBe('<1′');
  });
});

describe('popupPadding', () => {
  it('keeps the panel and a margin out of the popup placement area', () => {
    expect(popupPadding({ left: 350, bottom: 0 }, 12)).toEqual({ top: 12, right: 12, bottom: 12, left: 362 });
    expect(popupPadding({ left: 0, bottom: 170 }, 12)).toEqual({ top: 12, right: 12, bottom: 182, left: 12 });
  });
});

describe('panIntoView', () => {
  const area = { left: 362, top: 12, right: 1354, bottom: 848 };
  it('does not move a card already inside the free area', () => {
    expect(panIntoView({ left: 400, top: 100, right: 740, bottom: 500 }, area)).toEqual([0, 0]);
  });
  it('pans so a card under the side panel or past the bottom comes back in', () => {
    // Card 47 px under the panel and 30 px below the bottom: the content must move right and up.
    expect(panIntoView({ left: 315, top: 300, right: 655, bottom: 878 }, area)).toEqual([-47, 30]);
    expect(panIntoView({ left: 1100, top: -20, right: 1440, bottom: 400 }, area)).toEqual([86, -32]);
  });
  it('aligns the top-left corner when the card is larger than the area', () => {
    expect(panIntoView({ left: 300, top: 200, right: 640, bottom: 1100 }, area)).toEqual([-62, 188]);
  });
});
