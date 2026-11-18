import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, securityHeaders } from '@/lib/securityHeaders';

const csp = (dev: boolean) =>
  Object.fromEntries(contentSecurityPolicy(dev).split('; ').map((d) => [d.split(' ')[0], d.split(' ').slice(1)]));

describe('en-têtes de sécurité', () => {
  it('interdit eval, les plugins et l’intégration en iframe en production', () => {
    const p = csp(false);
    expect(p['script-src']).not.toContain("'unsafe-eval'");
    expect(p['object-src']).toEqual(["'none'"]);
    expect(p['frame-ancestors']).toEqual(["'none'"]);
    expect(p['upgrade-insecure-requests']).toEqual([]);
  });

  it('autorise seulement le fond de carte CARTO et les photos Wikimedia', () => {
    const p = csp(false);
    expect(p['connect-src']).toEqual(["'self'", 'https://basemaps.cartocdn.com', 'https://tiles.basemaps.cartocdn.com']);
    expect(p['img-src']).toContain('https://upload.wikimedia.org');
    expect(p['script-src'].filter((s) => s.startsWith('http'))).toEqual([]);
  });

  it('assouplit juste ce qu’il faut en dev (eval, websocket), sans HSTS', () => {
    const p = csp(true);
    expect(p['script-src']).toContain("'unsafe-eval'");
    expect(p['connect-src']).toContain('ws:');
    expect(securityHeaders(true).map((h) => h.key)).not.toContain('Strict-Transport-Security');
    expect(securityHeaders(false).map((h) => h.key)).toContain('Strict-Transport-Security');
  });

  it('envoie les en-têtes de base', () => {
    const keys = securityHeaders(false).map((h) => h.key);
    for (const k of ['Content-Security-Policy', 'X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy', 'Permissions-Policy']) expect(keys).toContain(k);
  });
});
