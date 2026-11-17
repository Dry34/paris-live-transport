import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MODELS } from '@/lib/rollingStock';
import { missionText, runUnits, trainProfile, PROFILE_MAX_W } from '@/lib/client/trainProfile';
import { TrainIllustration } from '@/components/TrainIllustration';
import { VehiclePopup } from '@/components/VehiclePopup';
import type { Mode, Network, VehicleRun } from '@/lib/types';
import type { RunPosition } from '@/lib/client/interpolate';

describe('trainProfile', () => {
  it('draws cars × units cars', () => {
    expect(trainProfile(MODELS['mf01'], 1)?.cars).toHaveLength(5);
    expect(trainProfile(MODELS['z50000-8'], 2)?.cars).toHaveLength(16);
    expect(trainProfile(MODELS['citadis-402'], 1)?.cars).toHaveLength(7);
  });

  it('falls back to the generic drawing for an unknown model', () => {
    expect(trainProfile(undefined, 1)).toBeNull();
    expect(trainProfile(null, 2)).toBeNull();
  });

  it('puts a cab at both ends of every unit and nowhere else', () => {
    const p = trainProfile(MODELS['z20500'], 2)!;
    expect(p.cars.map((c) => [c.cabLeft, c.cabRight])).toEqual([
      [true, false], [false, false], [false, false], [false, true],
      [true, false], [false, false], [false, false], [false, true],
    ]);
  });

  it('gives each car its doors, inside the car and clear of each other', () => {
    for (const model of Object.values(MODELS)) {
      for (const units of [1, 2]) {
        const p = trainProfile(model, units)!;
        for (const car of p.cars) {
          expect(car.doors, model.id).toHaveLength(model.doorsPerCar);
          const xs = [...car.doors].sort((a, b) => a - b);
          xs.forEach((x, i) => {
            expect(x).toBeGreaterThanOrEqual(car.x);
            expect(x + p.doorW).toBeLessThanOrEqual(car.x + car.w);
            if (i > 0) expect(x - xs[i - 1], model.id).toBeGreaterThan(p.doorW);
          });
          for (const bay of car.bays) {
            expect(bay.w).toBeGreaterThan(0);
            expect(bay.x).toBeGreaterThanOrEqual(car.x);
            expect(bay.x + bay.w).toBeLessThanOrEqual(car.x + car.w);
          }
        }
      }
    }
  });

  it('draws double-deck stock with two window rows', () => {
    expect(trainProfile(MODELS['mi09'], 1)!.windowRows).toHaveLength(2);
    expect(trainProfile(MODELS['mp05'], 1)!.windowRows).toHaveLength(1);
  });

  it('shortens the cars of a long train so it stays readable in the card', () => {
    const p = trainProfile(MODELS['regio2n'], 2)!;
    expect(p.viewW).toBeLessThanOrEqual(PROFILE_MAX_W + 12);
  });

  it('keeps every catalogue model within the card width, SNCF stock even as a long (double) train', () => {
    for (const model of Object.values(MODELS)) {
      // Only SNCF runs carry « long » (runUnits = 2); metro and tram runs are always one unit.
      const unitCounts = model.mode === 'metro' || model.mode === 'tram' ? [1] : [1, 2];
      for (const units of unitCounts) {
        expect(trainProfile(model, units)!.viewW, `${model.id} x${units}`).toBeLessThanOrEqual(PROFILE_MAX_W + 12);
      }
    }
  });
});

describe('TrainIllustration', () => {
  it('keeps the generic drawing without a model and uses the livery with one', () => {
    const generic = renderToStaticMarkup(createElement(TrainIllustration, { mode: 'metro', color: '#ffcd00' }));
    expect(generic).toContain('#ffcd00');
    const model = MODELS['mf19'];
    const real = renderToStaticMarkup(createElement(TrainIllustration, { mode: 'metro', color: '#ffcd00', model, units: 1 }));
    expect(real).toContain(model.livery.body);
    expect(real).toContain(model.livery.door);
    expect(real).not.toContain('#ffcd00');
  });
});

describe('vehicle card wording', () => {
  it('shows the mission and the train number only when known', () => {
    expect(missionText({ mission: 'QIWI', trainNumber: '137594' })).toBe('QIWI · train 137594');
    expect(missionText({ mission: 'QIWI', trainNumber: null })).toBe('QIWI');
    expect(missionText({ mission: null, trainNumber: '137594' })).toBe('train 137594');
    expect(missionText({})).toBeNull();
    expect(missionText({ mission: null, trainNumber: null })).toBeNull();
  });

  it('counts two units for a long train', () => {
    expect(runUnits({ length: 'long' })).toBe(2);
    expect(runUnits({ length: 'short' })).toBe(1);
    expect(runUnits({})).toBe(1);
  });
});

describe('VehiclePopup', () => {
  const line = (id: string, mode: Mode, shortName: string) => ({ id, shortName, mode, color: '#888888', textColor: '#ffffff', longName: shortName, shapes: [] });
  const network: Network = {
    generatedAt: '',
    lines: { C01727: line('C01727', 'rer', 'C'), C01384: line('C01384', 'metro', '14'), X: line('X', 'metro', 'X') },
    quays: {},
    stations: {},
    patterns: [],
    segments: {},
  };
  const position: RunPosition = { coord: [2.35, 48.85], state: 'moving', segmentKey: null, fraction: 0, nextQuay: null, nextTime: null, bearing: null };
  const run = (lineId: string, extra: Partial<VehicleRun> = {}): VehicleRun => ({
    id: `r-${lineId}`, lineId, direction: '0', destination: 'Terminus', stops: [], hasPrevious: false, prevInferred: false, ...extra,
  });
  const render = (r: VehicleRun) =>
    renderToStaticMarkup(createElement(VehiclePopup, { network, run: r, runs: [r], position, fetchedAt: 0, now: 1_000, onOpenLine: () => {} }));

  it('shows the SNCF mission, the train number and the model, without loading the photo', () => {
    const html = render(run('C01727', { mission: 'QIWI', trainNumber: '137594', length: 'long' }));
    expect(html).toContain('QIWI · train 137594');
    expect(html).toContain('Z 20500');
    expect(html).toMatch(/<button[^>]*class="vc-model"/);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('upload.wikimedia.org');
  });

  it('shows neither mission nor number on a RATP run', () => {
    const html = render(run('C01384'));
    expect(html).toContain('MP 14 CA');
    expect(html).not.toContain('vc-mission');
    expect(html).not.toMatch(/null|undefined|train \d/);
  });

  it('keeps the generic drawing and no model name for a line outside the catalogue', () => {
    const html = render(run('X'));
    expect(html).toContain('train-illustration');
    expect(html).not.toContain('vc-stock');
  });
});
