// HTTP security headers sent with every response (wired in next.config.ts).

/** Third-party origins the page talks to: CARTO basemap (style, tiles, glyphs, sprites) and Wikimedia photos. */
const BASEMAP = ['https://basemaps.cartocdn.com', 'https://tiles.basemaps.cartocdn.com'];
const PHOTOS = ['https://upload.wikimedia.org'];

/** Content-Security-Policy. `dev` adds what the Next dev server needs (eval for fast refresh, its websocket). */
export function contentSecurityPolicy(dev: boolean): string {
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    // Next injects inline bootstrap scripts; no third-party script is ever loaded.
    'script-src': ["'self'", "'unsafe-inline'", ...(dev ? ["'unsafe-eval'"] : [])],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', ...BASEMAP, ...PHOTOS],
    'font-src': ["'self'"],
    'connect-src': ["'self'", ...BASEMAP, ...(dev ? ['ws:'] : [])],
    // MapLibre's worker is served from /maplibre/worker.mjs; blob: for its fallback workers.
    'worker-src': ["'self'", 'blob:'],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
  };
  const csp = Object.entries(directives).map(([k, v]) => `${k} ${v.join(' ')}`);
  if (!dev) csp.push('upgrade-insecure-requests');
  return csp.join('; ');
}

export function securityHeaders(dev: boolean): { key: string; value: string }[] {
  return [
    { key: 'Content-Security-Policy', value: contentSecurityPolicy(dev) },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()' },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
    ...(dev ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }]),
  ];
}
