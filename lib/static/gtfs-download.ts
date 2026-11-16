// Download of the IDFM GTFS zip with a time-based local cache (used by scripts/build-data.ts).
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export interface EnsureGtfsZipOptions {
  zipPath: string;
  url: string;
  maxAgeMs: number;
  /** Ignore the cache and download again. */
  force?: boolean;
  fetchFn?: (url: string) => Promise<Response>;
  now?: () => number;
}

/**
 * Makes sure `zipPath` holds the GTFS zip. A non-empty file younger than `maxAgeMs` is reused;
 * otherwise the zip is streamed to `<zipPath>.part` and renamed, so a failed download never
 * replaces (or leaves behind) a partial file.
 */
export async function ensureGtfsZip(opts: EnsureGtfsZipOptions): Promise<'cache' | 'downloaded'> {
  const { zipPath, url, maxAgeMs, force = false, fetchFn = fetch, now = Date.now } = opts;
  if (!force && existsSync(zipPath)) {
    const st = statSync(zipPath);
    if (st.size > 0 && now() - st.mtimeMs < maxAgeMs) return 'cache';
  }
  mkdirSync(path.dirname(zipPath), { recursive: true });
  const res = await fetchFn(url);
  if (!res.ok || !res.body) throw new Error(`Téléchargement GTFS : HTTP ${res.status}`);
  const tmp = `${zipPath}.part`;
  try {
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(tmp));
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
  renameSync(tmp, zipPath);
  return 'downloaded';
}
