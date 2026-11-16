import { describe, expect, it } from 'vitest';
import { inServiceWindow, nextDelayMs, parisDay } from '@/lib/realtime/schedule';

const S = 1000;

describe('inServiceWindow', () => {
  // Novembre : Paris = UTC+1.
  it('fermé avant 05:00 Paris, ouvert à 05:00', () => {
    expect(inServiceWindow(Date.parse('2026-11-16T03:59:00Z'))).toBe(false); // 04:59 Paris
    expect(inServiceWindow(Date.parse('2026-11-16T04:00:00Z'))).toBe(true); // 05:00 Paris
  });

  it('ouvert jusqu’à 01:29 le lendemain, fermé à 01:30', () => {
    expect(inServiceWindow(Date.parse('2026-11-17T00:29:00Z'))).toBe(true); // 01:29 Paris
    expect(inServiceWindow(Date.parse('2026-11-17T00:30:00Z'))).toBe(false); // 01:30 Paris
  });

  it('respecte l’heure d’été (UTC+2)', () => {
    expect(inServiceWindow(Date.parse('2026-07-01T03:00:00Z'))).toBe(true); // 05:00 Paris
    expect(inServiceWindow(Date.parse('2026-07-01T02:59:00Z'))).toBe(false); // 04:59 Paris
  });
});

describe('parisDay', () => {
  it('donne le jour calendaire Europe/Paris', () => {
    expect(parisDay(Date.parse('2026-11-16T23:30:00Z'))).toBe('2026-11-17');
    expect(parisDay(Date.parse('2026-11-16T22:59:00Z'))).toBe('2026-11-16');
    expect(parisDay(Date.parse('2026-07-01T22:00:00Z'))).toBe('2026-07-02'); // minuit heure d'été
  });
});

describe('nextDelayMs', () => {
  const now = Date.parse('2026-11-16T10:00:00Z'); // 11:00 Paris
  const base = { lastFetch: null as number | null, failures: 0, callsToday: 0, intervalMs: 100 * S, cap: 900 };

  it('appelle tout de suite sans appel précédent', () => {
    expect(nextDelayMs(now, base)).toBe(0);
  });

  it('attend la fin de l’intervalle', () => {
    expect(nextDelayMs(now, { ...base, lastFetch: now - 40 * S })).toBe(60_000);
  });

  it('ne renvoie jamais un délai négatif', () => {
    expect(nextDelayMs(now, { ...base, lastFetch: now - 500 * S })).toBe(0);
  });

  it('backoff exponentiel après échecs', () => {
    expect(nextDelayMs(now, { ...base, lastFetch: now - 40 * S, failures: 2 })).toBe(400_000 - 40_000);
  });

  it('backoff borné à 15 min', () => {
    const d = nextDelayMs(now, { ...base, lastFetch: now, failures: 10 });
    expect(d).not.toBeNull();
    expect(d!).toBeLessThanOrEqual(900_000);
    expect(d!).toBe(900_000);
  });

  it('null quand le plafond est atteint', () => {
    expect(nextDelayMs(now, { ...base, callsToday: 900 })).toBeNull();
  });

  it('null hors fenêtre de service', () => {
    expect(nextDelayMs(Date.parse('2026-11-16T02:00:00Z'), base)).toBeNull(); // 03:00 Paris
  });
});
