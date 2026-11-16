import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ensureGtfsZip } from '../lib/static/gtfs-download';

const DAY = 24 * 3600 * 1000;
const URL = 'https://example.test/gtfs.zip';

function fakeFetch(body: string | null, status = 200) {
  const calls: string[] = [];
  const fn = async (url: string): Promise<Response> => {
    calls.push(url);
    return new Response(body, { status });
  };
  return { fn, calls };
}

let dir: string;
let zip: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'gtfs-dl-'));
  zip = path.join(dir, 'sub/gtfs.zip');
});

describe('ensureGtfsZip', () => {
  it('downloads when there is no cache, creating the directory', async () => {
    const f = fakeFetch('ZIPDATA');
    const r = await ensureGtfsZip({ zipPath: zip, url: URL, maxAgeMs: DAY, fetchFn: f.fn });
    expect(r).toBe('downloaded');
    expect(f.calls).toEqual([URL]);
    expect(readFileSync(zip, 'utf8')).toBe('ZIPDATA');
    expect(existsSync(`${zip}.part`)).toBe(false);
  });

  it('reuses a cache younger than maxAge without fetching', async () => {
    await ensureGtfsZip({ zipPath: zip, url: URL, maxAgeMs: DAY, fetchFn: fakeFetch('OLD').fn });
    const f = fakeFetch('NEW');
    const r = await ensureGtfsZip({ zipPath: zip, url: URL, maxAgeMs: DAY, fetchFn: f.fn, now: () => Date.now() + DAY - 60_000 });
    expect(r).toBe('cache');
    expect(f.calls).toEqual([]);
    expect(readFileSync(zip, 'utf8')).toBe('OLD');
  });

  it('re-downloads a cache older than maxAge', async () => {
    await ensureGtfsZip({ zipPath: zip, url: URL, maxAgeMs: DAY, fetchFn: fakeFetch('OLD').fn });
    const old = (Date.now() - DAY - 60_000) / 1000;
    utimesSync(zip, old, old);
    const f = fakeFetch('NEW');
    expect(await ensureGtfsZip({ zipPath: zip, url: URL, maxAgeMs: DAY, fetchFn: f.fn })).toBe('downloaded');
    expect(f.calls).toEqual([URL]);
    expect(readFileSync(zip, 'utf8')).toBe('NEW');
  });

  it('re-downloads an empty cached file', async () => {
    await ensureGtfsZip({ zipPath: zip, url: URL, maxAgeMs: DAY, fetchFn: fakeFetch('X').fn });
    writeFileSync(zip, '');
    const f = fakeFetch('NEW');
    expect(await ensureGtfsZip({ zipPath: zip, url: URL, maxAgeMs: DAY, fetchFn: f.fn })).toBe('downloaded');
    expect(readFileSync(zip, 'utf8')).toBe('NEW');
  });

  it('force re-downloads even with a fresh cache', async () => {
    await ensureGtfsZip({ zipPath: zip, url: URL, maxAgeMs: DAY, fetchFn: fakeFetch('OLD').fn });
    const f = fakeFetch('NEW');
    expect(await ensureGtfsZip({ zipPath: zip, url: URL, maxAgeMs: DAY, fetchFn: f.fn, force: true })).toBe('downloaded');
    expect(readFileSync(zip, 'utf8')).toBe('NEW');
  });

  it('throws on HTTP error and keeps the previous cache untouched, no .part left', async () => {
    await ensureGtfsZip({ zipPath: zip, url: URL, maxAgeMs: DAY, fetchFn: fakeFetch('OLD').fn });
    const old = (Date.now() - 2 * DAY) / 1000;
    utimesSync(zip, old, old);
    await expect(ensureGtfsZip({ zipPath: zip, url: URL, maxAgeMs: DAY, fetchFn: fakeFetch('nope', 503).fn })).rejects.toThrow(/503/);
    expect(readFileSync(zip, 'utf8')).toBe('OLD');
    expect(existsSync(`${zip}.part`)).toBe(false);
  });

  it('removes the .part file when the body stream fails midway', async () => {
    const failing = async (): Promise<Response> => {
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new TextEncoder().encode('PARTIAL'));
          c.error(new Error('connection reset'));
        },
      });
      return new Response(body, { status: 200 });
    };
    await expect(ensureGtfsZip({ zipPath: zip, url: URL, maxAgeMs: DAY, fetchFn: failing })).rejects.toThrow(/connection reset/);
    expect(existsSync(zip)).toBe(false);
    expect(existsSync(`${zip}.part`)).toBe(false);
  });
});
