// Télécharge le GTFS IDFM et écrit public/data/network.json.
// Usage : npm run build:data [-- --force]   (--force ignore le cache .cache/gtfs.zip)
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';
import yauzl from 'yauzl';
import { parse } from 'csv-parse';
import type { LineInfo, LngLat, Network, Pattern, Segment } from '../lib/types';
import { TARGET_LINES, TARGET_LINE_IDS } from '../lib/lines';
import {
  buildPatterns,
  buildSegments,
  buildStations,
  computeRuntimes,
  groupStopTimes,
  simplifyLine,
  stripIdfm,
  type GtfsStop,
  type GtfsStopTime,
  type GtfsTrip,
} from '../lib/static/gtfs-build';
import { ensureGtfsZip } from '../lib/static/gtfs-download';

const GTFS_URL = 'https://eu.ftp.opendatasoft.com/stif/GTFS/IDFM-gtfs.zip';
const ROOT = path.resolve(__dirname, '..');
const ZIP = path.join(ROOT, '.cache/gtfs.zip');
const OUT = path.join(ROOT, 'public/data/network.json');
const MAX_AGE_MS = 24 * 3600 * 1000;
const SIMPLIFY_M = 5;

async function ensureZip(): Promise<void> {
  const force = process.argv.includes('--force');
  if (!force) console.log('Cache GTFS :', ZIP, '(réutilisé s’il a < 24 h)');
  else console.log('Téléchargement forcé', GTFS_URL);
  const t0 = Date.now();
  const r = await ensureGtfsZip({ zipPath: ZIP, url: GTFS_URL, maxAgeMs: MAX_AGE_MS, force });
  console.log(r === 'cache' ? 'GTFS en cache (< 24 h), pas de téléchargement' : `GTFS téléchargé en ${((Date.now() - t0) / 1000).toFixed(0)} s (${(statSync(ZIP).size / 1e6).toFixed(1)} Mo)`);
}

function openZip(file: string): Promise<{ zip: yauzl.ZipFile; entries: Map<string, yauzl.Entry> }> {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true, autoClose: false }, (err, zip) => {
      if (err || !zip) return reject(err);
      const entries = new Map<string, yauzl.Entry>();
      zip.on('entry', (e: yauzl.Entry) => {
        entries.set(e.fileName, e);
        zip.readEntry();
      });
      zip.on('end', () => resolve({ zip, entries }));
      zip.on('error', reject);
      zip.readEntry();
    });
  });
}

/** Streams one CSV file of the zip, calling onRow for every record (never loads the file whole). */
async function streamCsv(
  zip: yauzl.ZipFile,
  entries: Map<string, yauzl.Entry>,
  name: string,
  onRow: (row: Record<string, string>) => void,
): Promise<void> {
  const entry = entries.get(name);
  if (!entry) throw new Error(`${name} absent du GTFS`);
  const stream = await new Promise<Readable>((resolve, reject) =>
    zip.openReadStream(entry, (err, s) => (err || !s ? reject(err) : resolve(s))),
  );
  const parser = stream.pipe(parse({ columns: true, bom: true, skip_empty_lines: true, relax_column_count: true }));
  let n = 0;
  for await (const row of parser) {
    onRow(row);
    n++;
  }
  console.log(`  ${name} : ${n} lignes lues`);
}

const r5 = (n: number) => Math.round(n * 1e5) / 1e5;
const roundCoords = (line: LngLat[]): LngLat[] => line.map(([x, y]) => [r5(x), r5(y)]);

async function main(): Promise<void> {
  await ensureZip();
  const { zip, entries } = await openZip(ZIP);

  const routes = new Map<string, Record<string, string>>();
  await streamCsv(zip, entries, 'routes.txt', (r) => {
    if (TARGET_LINE_IDS.has(stripIdfm(r.route_id))) routes.set(stripIdfm(r.route_id), r);
  });

  const trips: GtfsTrip[] = [];
  await streamCsv(zip, entries, 'trips.txt', (r) => {
    if (!TARGET_LINE_IDS.has(stripIdfm(r.route_id))) return;
    trips.push({ trip_id: r.trip_id, route_id: r.route_id, direction_id: r.direction_id, shape_id: r.shape_id, trip_headsign: r.trip_headsign });
  });
  const tripIds = new Set(trips.map((t) => t.trip_id));

  const stopTimes: GtfsStopTime[] = [];
  await streamCsv(zip, entries, 'stop_times.txt', (r) => {
    if (!tripIds.has(r.trip_id)) return;
    stopTimes.push({ trip_id: r.trip_id, stop_id: r.stop_id, stop_sequence: r.stop_sequence, arrival_time: r.arrival_time, departure_time: r.departure_time });
  });
  const byTrip = groupStopTimes(stopTimes);
  stopTimes.length = 0;

  const patterns = buildPatterns(trips, byTrip);
  const runtimes = computeRuntimes(byTrip);

  // shape of a pattern = most frequent shape_id among its trips
  const patternByKey = new Map<string, Pattern>(patterns.map((p) => [`${p.lineId}|${p.directionId}|${p.quays.join('>')}`, p]));
  const shapeCounts = new Map<Pattern, Map<string, number>>();
  for (const t of trips) {
    const sts = byTrip.get(t.trip_id);
    if (!sts || !t.shape_id) continue;
    const dir = t.direction_id === '1' ? 1 : 0;
    const p = patternByKey.get(`${stripIdfm(t.route_id)}|${dir}|${sts.map((s) => stripIdfm(s.stop_id)).join('>')}`);
    if (!p) continue;
    const counts = shapeCounts.get(p) ?? new Map<string, number>();
    counts.set(t.shape_id, (counts.get(t.shape_id) ?? 0) + 1);
    shapeCounts.set(p, counts);
  }
  const shapeIdOfPattern = new Map<Pattern, string>();
  for (const [p, counts] of shapeCounts) shapeIdOfPattern.set(p, [...counts].sort((a, b) => b[1] - a[1])[0][0]);
  const usedShapeIds = new Set(shapeIdOfPattern.values());

  const shapePts = new Map<string, { seq: number; pt: LngLat }[]>();
  await streamCsv(zip, entries, 'shapes.txt', (r) => {
    if (!usedShapeIds.has(r.shape_id)) return;
    const list = shapePts.get(r.shape_id) ?? [];
    list.push({ seq: Number(r.shape_pt_sequence), pt: [Number(r.shape_pt_lon), Number(r.shape_pt_lat)] });
    shapePts.set(r.shape_id, list);
  });
  const shapes = new Map<string, LngLat[]>();
  for (const [id, list] of shapePts) shapes.set(id, list.sort((a, b) => a.seq - b.seq).map((x) => x.pt));

  const stops: GtfsStop[] = [];
  await streamCsv(zip, entries, 'stops.txt', (r) => {
    stops.push({ stop_id: r.stop_id, stop_name: r.stop_name, stop_lat: r.stop_lat, stop_lon: r.stop_lon, parent_station: r.parent_station });
  });
  zip.close();

  const usedQuays = new Set(patterns.flatMap((p) => p.quays));
  const { quays, stations } = buildStations(stops, usedQuays, patterns);
  const shapeOfPattern = new Map<Pattern, LngLat[]>();
  for (const [p, id] of shapeIdOfPattern) {
    const s = shapes.get(id);
    if (s) shapeOfPattern.set(p, s);
  }
  const rawSegments = buildSegments(patterns, quays, shapeOfPattern, runtimes);

  const segments: Record<string, Segment> = {};
  for (const [k, s] of Object.entries(rawSegments)) segments[k] = { coords: roundCoords(s.coords), seconds: Math.round(s.seconds) };
  for (const q of Object.values(quays)) [q.lon, q.lat] = [r5(q.lon), r5(q.lat)];
  for (const s of Object.values(stations)) [s.lon, s.lat] = [r5(s.lon), r5(s.lat)];

  const lines: Network['lines'] = {};
  for (const { id, mode } of TARGET_LINES) {
    const r = routes.get(id);
    if (!r) {
      console.warn(`Ligne ${id} absente de routes.txt`);
      continue;
    }
    const info: LineInfo = {
      id,
      shortName: r.route_short_name,
      mode,
      color: `#${r.route_color || '888888'}`,
      textColor: `#${r.route_text_color || 'FFFFFF'}`,
      longName: r.route_long_name,
    };
    const ids = new Set(patterns.filter((p) => p.lineId === id).map((p) => shapeIdOfPattern.get(p)).filter((x): x is string => !!x));
    const lineShapes = [...ids].map((sid) => shapes.get(sid)).filter((s): s is LngLat[] => !!s).map((s) => roundCoords(simplifyLine(s, SIMPLIFY_M)));
    lines[id] = { ...info, shapes: lineShapes };
  }

  const network: Network = { generatedAt: new Date().toISOString(), lines, quays, stations, patterns, segments };
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(network));
  console.log(
    `network.json : ${Object.keys(lines).length} lignes, ${patterns.length} patterns, ${Object.keys(stations).length} stations, ` +
      `${Object.keys(quays).length} quais, ${Object.keys(segments).length} segments, ${(statSync(OUT).size / 1e6).toFixed(2)} Mo`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
