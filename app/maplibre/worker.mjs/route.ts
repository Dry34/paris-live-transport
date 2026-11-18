import { readFile } from 'node:fs/promises';
import path from 'node:path';

// Serves the installed maplibre-gl worker module (see lib/client/maplibreWorker.ts). Read from node_modules so it
// always matches the main bundle's version.
export const runtime = 'nodejs';

const WORKER_FILE = path.join(process.cwd(), 'node_modules', 'maplibre-gl', 'dist', 'maplibre-gl-worker.mjs');

export async function GET(): Promise<Response> {
  const body = await readFile(WORKER_FILE, 'utf8');
  return new Response(body, {
    headers: {
      'Content-Type': 'text/javascript; charset=utf-8',
      // The client URL carries ?v=<maplibre version>.
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
