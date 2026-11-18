import { describe, expect, it } from 'vitest';
import { liveCacheControl } from '@/lib/realtime/httpCache';

describe('cache des routes temps réel', () => {
  it('partage la réponse quelques secondes sur le CDN en production, rien en local', () => {
    expect(liveCacheControl(true)).toContain('s-maxage=30');
    expect(liveCacheControl(false)).toBe('no-store');
  });
});
