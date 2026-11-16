import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { GET } from '@/app/maplibre/worker.mjs/route';
import { maplibreWorkerUrl } from '@/lib/client/maplibreWorker';

const workerFile = path.join(process.cwd(), 'node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs');

describe('MapLibre worker route', () => {
  it('serves the installed maplibre-gl worker as a JavaScript module', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/javascript/);
    expect(await res.text()).toBe(readFileSync(workerFile, 'utf8'));
  });

  it('is cached and the client URL is versioned with the installed maplibre-gl', async () => {
    const res = await GET();
    expect(res.headers.get('cache-control')).toContain('max-age');
    const { version } = JSON.parse(readFileSync(path.join(process.cwd(), 'node_modules/maplibre-gl/package.json'), 'utf8'));
    expect(maplibreWorkerUrl(version)).toBe(`/maplibre/worker.mjs?v=${version}`);
  });
});
