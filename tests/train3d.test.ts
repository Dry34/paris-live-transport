import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Network, VehicleRun } from '@/lib/types';
import type { RunPosition } from '@/lib/client/interpolate';
import { carPoses, carsOf, headingRad, localMeters, model3dForLine, modelScale, MODEL_MIN_ZOOM, trackAround } from '@/lib/client/train3d';

describe('modèles 3D', () => {
  it('donne le Francilien aux lignes en Z 50000 et rien aux autres', () => {
    for (const id of ['C01739', 'C01740', 'C01737', 'C01738']) expect(model3dForLine(id)?.url, id).toBe('/models/z50000.glb');
    expect(model3dForLine('C01371')).toBeNull(); // M1
    expect(model3dForLine('inconnue')).toBeNull();
  });

  it('a son fichier dans public', () => {
    expect(existsSync(path.join(process.cwd(), 'public/models/z50000.glb'))).toBe(true);
  });

  it('place un point en mètres est/nord autour de l’origine', () => {
    const o: [number, number] = [2.35, 48.85];
    expect(localMeters(o, o)).toEqual([0, 0]);
    const [e, n] = localMeters(o, [2.35, 48.86]); // ~1.11 km au nord
    expect(Math.abs(e)).toBeLessThan(1e-6);
    expect(n).toBeGreaterThan(1080);
    expect(n).toBeLessThan(1140);
    const [e2, n2] = localMeters(o, [2.36, 48.85]); // ~732 m à l’est
    expect(e2).toBeGreaterThan(710);
    expect(e2).toBeLessThan(750);
    expect(Math.abs(n2)).toBeLessThan(1e-6);
  });

  it('oriente le modèle (axe x) selon le cap', () => {
    expect(headingRad(90)).toBeCloseTo(0); // vers l’est
    expect(headingRad(0)).toBeCloseTo(Math.PI / 2); // vers le nord
    expect(headingRad(180)).toBeCloseTo(-Math.PI / 2);
  });

  it('grossit le modèle quand on dézoome, échelle réelle de près', () => {
    expect(modelScale(19, 48.85)).toEqual({ length: 1, cross: 1 });
    const far = modelScale(MODEL_MIN_ZOOM, 48.85);
    expect(far.length).toBeGreaterThan(modelScale(MODEL_MIN_ZOOM + 1, 48.85).length);
    // widened more than lengthened, within 3×
    expect(far.cross).toBeGreaterThan(far.length);
    expect(far.cross).toBeLessThanOrEqual(far.length * 3);
  });
});

describe('voitures qui suivent la voie', () => {
  const O: [number, number] = [2.35, 48.85];
  // ~1 m in degrees around Paris
  const dLat = 1 / 111_195;
  const dLon = dLat / Math.cos((48.85 * Math.PI) / 180);
  const east = (m: number): [number, number] => [O[0] + m * dLon, O[1]];
  const at = (e: number, n: number): [number, number] => [O[0] + e * dLon, O[1] + n * dLat];

  it('découpe le Francilien en 7 voitures jointives', () => {
    const cars = carsOf(model3dForLine('C01739')!);
    expect(cars).toHaveLength(7);
    expect(cars[0].center - cars[0].half).toBeCloseTo(-47.4);
    expect(cars[6].center + cars[6].half).toBeCloseTo(47.4);
    for (let i = 1; i < 7; i++) expect(cars[i].center - cars[i].half).toBeCloseTo(cars[i - 1].center + cars[i - 1].half);
  });

  it('aligne les voitures sur une voie droite', () => {
    const cars = [{ center: -20, half: 10 }, { center: 0, half: 10 }, { center: 20, half: 10 }];
    const poses = carPoses({ coords: [east(0), east(500)], along: 250 }, cars, 1, O);
    poses.forEach((p, i) => {
      expect(p.e).toBeCloseTo(250 + cars[i].center, 0);
      expect(p.n).toBeCloseTo(0, 3);
      expect(p.heading).toBeCloseTo(0, 3);
    });
  });

  it('tourne chaque voiture dans un virage à angle droit', () => {
    // outside the smoothing window of the corner
    const cars = [{ center: -80, half: 10 }, { center: 80, half: 10 }];
    // east for 300 m, then north
    const poses = carPoses({ coords: [at(0, 0), at(300, 0), at(300, 300)], along: 300 }, cars, 1, O);
    expect(poses[0].heading).toBeCloseTo(0, 2); // rear car still heading east
    expect(poses[1].heading).toBeCloseTo(Math.PI / 2, 2); // front car already heading north
    expect(poses[1].e).toBeCloseTo(300, 0);
    expect(poses[1].n).toBeCloseTo(80, 0);
  });

  it('prolonge la voie au-delà de ses extrémités', () => {
    const poses = carPoses({ coords: [east(0), east(10)], along: 5 }, [{ center: 50, half: 5 }], 1, O);
    expect(poses[0].e).toBeCloseTo(55, 0);
    expect(poses[0].heading).toBeCloseTo(0, 3);
  });

  it('allonge le train (et ses écarts) quand il est agrandi', () => {
    const poses = carPoses({ coords: [east(0), east(1000)], along: 500 }, [{ center: 20, half: 10 }], 3, O);
    expect(poses[0].e).toBeCloseTo(560, 0);
  });

  it('assemble les sections autour du train et sa distance le long', () => {
    const network = {
      segments: {
        'A>B': { coords: [east(0), east(100)], seconds: 60 },
        'B>C': { coords: [east(100), east(300)], seconds: 60 },
        'C>D': { coords: [east(300), east(350)], seconds: 60 },
      },
    } as unknown as Network;
    const run = { stops: ['A', 'B', 'C', 'D'].map((quay) => ({ quay, arr: 0, dep: 0 })) } as unknown as VehicleRun;
    const moving = { segmentKey: 'B>C', fraction: 0.5, nextQuay: 'C' } as RunPosition;
    const t = trackAround(run, network, moving)!;
    expect(t.coords).toHaveLength(4);
    expect(t.along).toBeCloseTo(200, 0);
    const standing = { segmentKey: null, fraction: 0, nextQuay: 'C' } as RunPosition;
    const t2 = trackAround(run, network, standing)!;
    expect(t2.along).toBeCloseTo(200, 0);
    expect(trackAround(run, network, { segmentKey: null, fraction: 0, nextQuay: 'Z' } as RunPosition)).toBeNull();
  });
});

describe('raccords de sections', () => {
  const O: [number, number] = [2.35, 48.85];
  const dLat = 1 / 111_195;
  const dLon = dLat / Math.cos((48.85 * Math.PI) / 180);
  const at = (e: number, n: number): [number, number] => [O[0] + e * dLon, O[1] + n * dLat];

  it('ne met aucune voiture en travers sur un crochet de raccord', () => {
    // heading east, the next section starts on a parallel track 50 m north after a 17 m step
    const track = { coords: [at(-300, 0), at(0, 0), at(17, 50), at(300, 50)], along: 300 };
    const cars = carsOf(model3dForLine('C01737')!);
    for (const p of carPoses(track, cars, 1, O)) expect(Math.abs(p.heading), `${p.e},${p.n}`).toBeLessThan((60 * Math.PI) / 180);
  });
});
