// Cache-Control for the live data routes.

/**
 * In production the CDN keeps a response for a few seconds: every visitor shares one PRIM-backed snapshot, and the
 * function (and the PRIM quota) is not hit once per visitor. Locally nothing is cached.
 */
export function liveCacheControl(prod = process.env.NODE_ENV === 'production'): string {
  return prod ? 'public, max-age=0, s-maxage=30, stale-while-revalidate=60' : 'no-store';
}
