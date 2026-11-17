import { describe, expect, it } from 'vitest';
import { TARGET_LINES } from '@/lib/lines';
import { LINE_STOCK, MODELS, stockForLine, stockLabel } from '@/lib/rollingStock';

const HEX = /^#[0-9a-f]{6}$/i;
const FREE_LICENSE = /^(CC BY|CC BY-SA|CC0|Public domain)/;

describe('catalogue du matériel roulant', () => {
  it('donne au moins un modèle à chaque ligne ciblée', () => {
    for (const line of TARGET_LINES) {
      expect(stockForLine(line.id).length, line.id).toBeGreaterThan(0);
      // Shared SNCF stock (Regio 2N on RER D and N/R, Francilien on RER E and H/K/P) crosses rer/transilien,
      // but never metro or tram.
      for (const m of stockForLine(line.id)) {
        const rail = (mode: string) => (mode === 'rer' || mode === 'transilien' ? 'rail' : mode);
        expect(rail(m.mode), `${line.id} ${m.id}`).toBe(rail(line.mode));
      }
    }
  });

  it('ne référence que des modèles existants, sans doublon par ligne', () => {
    for (const [lineId, ids] of Object.entries(LINE_STOCK)) {
      expect(new Set(ids).size, lineId).toBe(ids.length);
      for (const id of ids) expect(MODELS[id], `${lineId} → ${id}`).toBeDefined();
    }
  });

  it('a des modèles aux paramètres de dessin cohérents', () => {
    for (const [id, m] of Object.entries(MODELS)) {
      expect(m.id).toBe(id);
      expect(m.name.trim()).not.toBe('');
      expect(Number.isInteger(m.cars) && m.cars >= 2 && m.cars <= 10, id).toBe(true);
      expect(Number.isInteger(m.doorsPerCar) && m.doorsPerCar >= 1 && m.doorsPerCar <= 4, id).toBe(true);
      expect([1, 2]).toContain(m.levels);
      expect(['rounded', 'flat', 'sloped', 'tram']).toContain(m.nose);
      for (const c of Object.values(m.livery)) expect(c, id).toMatch(HEX);
    }
  });

  it('a des photos complètes, sous licence libre, servies par upload.wikimedia.org', () => {
    for (const [id, m] of Object.entries(MODELS)) {
      if (m.photo === null) continue;
      const { url, page, author, license } = m.photo;
      expect(url, id).toMatch(/^https:\/\/upload\.wikimedia\.org\//);
      expect(page, id).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
      expect(author.trim(), id).not.toBe('');
      expect(author, id).not.toMatch(/[<>]/);
      expect(license, id).toMatch(FREE_LICENSE);
    }
  });

  it('renvoie une liste vide pour une ligne inconnue', () => {
    expect(stockForLine('inconnue')).toEqual([]);
  });

  it('met le modèle principal en premier', () => {
    expect(stockForLine('C01742')[0].name).toBe('MI 09'); // RER A
    expect(stockForLine('C01384').map((m) => m.name)).toEqual(['MP 14 CA']); // métro 14
  });

  it('étiquette une ligne mixte « A / B » et une ligne vide par null', () => {
    expect(stockLabel(stockForLine('C01743'))).toBe('MI 79 / MI 84'); // RER B
    expect(stockLabel(stockForLine('C01371'))).toBe('MP 05'); // métro 1
    expect(stockLabel([])).toBeNull();
  });
});
