// Pure helpers for the 3D trains drawn over the map (three.js custom layer in components/train3dLayer.ts).
import type { LngLat } from '../types';
import { stockForLine } from '../rollingStock';

/** glTF model per rolling-stock model id. */
const MODEL_FILES: Record<string, string> = {
  'z50000-7': '/models/z50000.glb',
  'z50000-8': '/models/z50000.glb',
};

/** Below this zoom trains stay 2D markers (a 120 m train is a few pixels long). */
export const MODEL_MIN_ZOOM = 13;
/** Length (m) of the models along their x axis. */
export const MODEL_LENGTH_M = 124;
/** Shortest drawn length (px): zoomed out, the model is scaled up to stay readable. */
export const MODEL_MIN_PX = 60;
/** Width (m) of the models (y axis before rotation) and shortest drawn width (px). */
export const MODEL_WIDTH_M = 4.2;
export const MODEL_MIN_WIDTH_PX = 9;
/** Widening never exceeds this many times the lengthening (keeps a train shape). */
const MAX_CROSS_RATIO = 3;

const EARTH_CIRCUMFERENCE_M = 40_075_016.686;
const rad = (d: number) => (d * Math.PI) / 180;

/** 3D model of the line's usual rolling stock, or null when none is available. */
export function model3dForLine(lineId: string): string | null {
  const first = stockForLine(lineId)[0];
  return (first && MODEL_FILES[first.id]) ?? null;
}

const mercX = (lon: number) => (lon + 180) / 360;
const mercY = (lat: number) => (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + rad(lat) / 2))) / 360;
/** Metres per web-mercator unit at a latitude. */
export const mercatorUnitsPerMeter = (lat: number) => 1 / (EARTH_CIRCUMFERENCE_M * Math.cos(rad(lat)));

/** Web-mercator coordinates (0..1) of a point. */
export const toMercator = ([lon, lat]: LngLat): [number, number] => [mercX(lon), mercY(lat)];

/** East/north offset (m, at the origin's mercator scale) of p from origin. */
export function localMeters(origin: LngLat, p: LngLat): [number, number] {
  const s = mercatorUnitsPerMeter(origin[1]);
  const [x0, y0] = toMercator(origin);
  const [x, y] = toMercator(p);
  return [(x - x0) / s, (y0 - y) / s];
}

/** Rotation around the up axis (rad, counter-clockwise from east) for a compass bearing (deg, clockwise from north). */
export const headingRad = (bearingDeg: number) => rad(90 - bearingDeg);

/** Scale factors (length, width/height) applied to the real-size model so it stays readable zoomed out. */
export function modelScale(zoom: number, lat: number): { length: number; cross: number } {
  const metersPerPx = (EARTH_CIRCUMFERENCE_M * Math.cos(rad(lat))) / (512 * 2 ** zoom);
  const length = Math.max(1, (MODEL_MIN_PX * metersPerPx) / MODEL_LENGTH_M);
  // A 4 m wide train is a hairline from above: widen it more than it is lengthened, within MAX_CROSS_RATIO.
  const cross = Math.min(length * MAX_CROSS_RATIO, Math.max(1, (MODEL_MIN_WIDTH_PX * metersPerPx) / MODEL_WIDTH_M));
  return { length, cross: Math.max(cross, length) };
}
