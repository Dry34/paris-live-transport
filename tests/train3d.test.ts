import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { headingRad, localMeters, model3dForLine, modelScale, MODEL_MIN_ZOOM } from '@/lib/client/train3d';

describe('modèles 3D', () => {
  it('donne le Francilien aux lignes en Z 50000 et rien aux autres', () => {
    for (const id of ['C01739', 'C01740', 'C01737', 'C01738']) expect(model3dForLine(id), id).toBe('/models/z50000.glb');
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
