import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { isActiveAt, parseDisruptions, parsePrimDate } from '@/lib/realtime/disruptions';
import { isTargetLine } from '@/lib/lines';

const raw = JSON.parse(readFileSync('tests/fixtures/disruptions-sample.json', 'utf8'));
const NOW = Date.parse('2026-11-16T11:43:00Z');

describe('parsePrimDate', () => {
  it('interprète l heure locale Paris (hiver et été)', () => {
    expect(parsePrimDate('20261116T120000')).toBe(Date.parse('2026-11-16T11:00:00Z'));
    expect(parsePrimDate('20260715T120000')).toBe(Date.parse('2026-07-15T10:00:00Z'));
    expect(parsePrimDate('nope')).toBeNaN();
  });
});

describe('parseDisruptions', () => {
  const out = parseDisruptions(raw, NOW);

  it('la fixture contient des perturbations cibles et hors cible', () => {
    const ids = new Set(raw.disruptions.map((d: { id: string }) => d.id));
    expect(ids.size).toBeLessThanOrEqual(30);
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThan(raw.disruptions.length);
  });

  it('ne garde que des perturbations de lignes ciblées', () => {
    for (const d of out) {
      expect(d.lineIds.length).toBeGreaterThan(0);
      for (const id of d.lineIds) expect(isTargetLine(id)).toBe(true);
    }
  });

  it('exclut les perturbations hors cible (bus, etc.)', () => {
    const kept = new Set(out.map((d) => d.id));
    const targetIds = new Set(
      raw.lines
        .filter((l: { id: string }) => isTargetLine(l.id.replace('line:IDFM:', '')))
        .flatMap((l: { impactedObjects: { disruptionIds: string[] }[] }) => l.impactedObjects.flatMap((o) => o.disruptionIds)),
    );
    const nonTarget = raw.disruptions.filter((d: { id: string }) => !targetIds.has(d.id));
    expect(nonTarget.length).toBeGreaterThan(0);
    for (const d of nonTarget) expect(kept.has(d.id)).toBe(false);
  });

  it('exclut une perturbation dont la période est passée', () => {
    const later = parseDisruptions(raw, Date.parse('2031-01-01T00:00:00Z'));
    expect(later).toEqual([]);
    expect(out.every((d) => isActiveAt(d, NOW))).toBe(true);
    const past = {
      disruptions: [{ id: 'p', applicationPeriods: [{ begin: '20261110T000000', end: '20261115T235959' }], severity: 'PERTURBEE', title: 'T', message: 'm' }],
      lines: [{ id: 'line:IDFM:C01371', impactedObjects: [{ type: 'line', id: 'x', disruptionIds: ['p'] }] }],
    };
    expect(parseDisruptions(past, NOW)).toEqual([]);
    expect(parseDisruptions(past, Date.parse('2026-11-12T12:00:00Z'))).toHaveLength(1);
  });

  it('message sans HTML ni chevron, entités décodées', () => {
    for (const d of out) {
      expect(d.message).not.toContain('<');
      expect(d.title).not.toContain('<');
      expect(d.message).not.toMatch(/&#\d+;/);
    }
    expect(out.some((d) => /[éèà]/.test(d.message))).toBe(true);
  });

  it('trié par sévérité puis par date', () => {
    const rank: Record<string, number> = { BLOQUANTE: 0, PERTURBEE: 1, INFORMATION: 2 };
    for (let i = 1; i < out.length; i++) expect(rank[out[i - 1].severity]).toBeLessThanOrEqual(rank[out[i].severity]);
  });

  it('entrée malformée : []', () => {
    for (const bad of [null, undefined, 42, 'x', [], {}, { disruptions: 'x' }, { disruptions: [null, 3, {}] }]) {
      expect(parseDisruptions(bad, NOW)).toEqual([]);
    }
  });

  it('lien par lines[].impactedObjects, ids avec ou sans préfixe, et impactedSections', () => {
    const mk = (extra: object) => ({
      disruptions: [{ id: 'd1', applicationPeriods: [{ begin: '20261116T000000', end: '20261117T000000' }], severity: 'BLOQUANTE', title: 'T', message: '<p>a &amp; b<br>c &lt;</p>', ...extra }],
      lines: [],
    });
    const viaLines = { ...mk({}), lines: [{ id: 'IDFM:C01371', impactedObjects: [{ type: 'line', id: 'x', disruptionIds: ['d1'] }] }] };
    expect(parseDisruptions(viaLines, NOW)[0]).toMatchObject({ id: 'd1', lineIds: ['C01371'], message: 'a & b\nc ‹' });
    const viaSection = mk({ impactedSections: [{ lineId: 'line:IDFM:C01742' }, { lineId: 'line:IDFM:C00001' }] });
    expect(parseDisruptions(viaSection, NOW)[0].lineIds).toEqual(['C01742']);
    expect(parseDisruptions(mk({}), NOW)).toEqual([]);
  });
});
