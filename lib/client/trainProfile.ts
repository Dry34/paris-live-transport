import type { Mode, VehicleRun } from '@/lib/types';
import type { NoseShape, RollingStockModel } from '@/lib/rollingStock';

// Pure geometry of a rolling-stock side view (viewBox units, heading right): car lengths, cab ends, doors,
// window bays and bogies, derived from a catalogue model. TrainIllustration only paints it in the livery.

export const VIEW_H = 48;
export const RAIL_Y = 44;
export const WHEEL_R = 3;
/** Longest train drawn at natural car length; longer trains get shorter cars so the card stays readable. */
export const PROFILE_MAX_W = 560;

const MARGIN = 6;
const CAR_GAP = 2;
const UNIT_GAP = 5;
const MIN_PANE = 4;
const MAX_PANE = 22;
const PILLAR = 1.6;

export interface Pane { x: number; w: number }
export interface ProfileCar {
  x: number;
  w: number;
  cabLeft: boolean;
  cabRight: boolean;
  /** Left edge of each door. */
  doors: number[];
  /** Side windows between the doors (one pane each). */
  bays: Pane[];
  axles: number[];
  pantograph: boolean;
}
export interface TrainProfile {
  model: RollingStockModel;
  cars: ProfileCar[];
  viewW: number;
  bodyY: number;
  bodyH: number;
  bodyBottom: number;
  doorW: number;
  doorTop: number;
  /** Length kept clear of doors and side windows behind each cab (windscreen and front mask). */
  cabLen: number;
  /** Nose setback at the roof line. */
  noseInset: number;
  windowRows: { y: number; h: number }[];
}

const BASE_LEN: Record<Mode, number> = { metro: 50, rer: 68, transilien: 68, tram: 44 };

function bodyHeight(mode: Mode, levels: 1 | 2): number {
  if (mode === 'metro' || mode === 'tram') return 21;
  return levels === 2 ? 31 : 25;
}

export function noseInset(nose: NoseShape, h: number): number {
  switch (nose) {
    case 'rounded':
      return Math.min(h * 0.6, 15);
    case 'sloped':
      return Math.min(h * 0.5, 12);
    case 'tram':
      return 8;
    default:
      return 3;
  }
}

/** Natural car lengths of one unit: trams with an odd module count alternate long (on bogies) and short modules. */
function unitLengths(model: RollingStockModel): number[] {
  if (model.mode === 'tram' && model.cars % 2 === 1 && model.cars > 1) {
    return Array.from({ length: model.cars }, (_, i) => (i % 2 === 0 ? 50 : 28));
  }
  const base = BASE_LEN[model.mode] + (model.levels === 2 ? 2 : 0);
  return Array.from({ length: model.cars }, () => base);
}

function split(from: number, to: number): Pane[] {
  const len = to - from;
  if (len < MIN_PANE) return [];
  const n = Math.ceil(len / MAX_PANE);
  const w = (len - PILLAR * (n - 1)) / n;
  return Array.from({ length: n }, (_, i) => ({ x: from + i * (w + PILLAR), w }));
}

/** Side view of `units` coupled units of `model`, or null without a model (the caller draws the generic train). */
export function trainProfile(model: RollingStockModel | null | undefined, units: number): TrainProfile | null {
  if (!model) return null;
  const unitCount = Math.max(1, Math.round(units));
  const bodyH = bodyHeight(model.mode, model.levels);
  const bodyBottom = RAIL_Y - WHEEL_R * 2 - (model.mode === 'tram' ? 0 : 1);
  const bodyY = bodyBottom - bodyH;
  const doorW = model.mode === 'metro' || model.mode === 'tram' ? 6 : 7;
  const inset = noseInset(model.nose, bodyH);
  const cabLen = Math.max(inset, 6) + 8;

  const lengths = Array.from({ length: unitCount }, () => unitLengths(model)).flat();
  const gaps = (lengths.length - unitCount) * CAR_GAP + (unitCount - 1) * UNIT_GAP;
  // Smallest length of each car that still fits its cab ends and doors.
  const minLens = lengths.map((_, k) => {
    const i = k % model.cars;
    const ends = (i === 0 ? cabLen : 3) + (i === model.cars - 1 ? cabLen : 3);
    return ends + model.doorsPerCar * (doorW + 4);
  });
  // Shrink the cars to the card width; cars held at their minimum hand the rest of the shortening to the others.
  const budget = PROFILE_MAX_W - gaps - 2 * MARGIN;
  let shrink = 1;
  for (let pass = 0; pass < lengths.length; pass++) {
    let held = 0;
    let free = 0;
    lengths.forEach((len, k) => {
      if (len * shrink <= minLens[k]) held += minLens[k];
      else free += len;
    });
    const next = free > 0 ? Math.min(1, Math.max(0, budget - held) / free) : shrink;
    if (Math.abs(next - shrink) < 1e-9) break;
    shrink = next;
  }

  const cars: ProfileCar[] = [];
  let x = MARGIN;
  for (let u = 0; u < unitCount; u++) {
    for (let i = 0; i < model.cars; i++) {
      const cabLeft = i === 0;
      const cabRight = i === model.cars - 1;
      const w = Math.max(lengths[u * model.cars + i] * shrink, minLens[u * model.cars + i]);
      const a = x + (cabLeft ? cabLen : 3);
      const b = x + w - (cabRight ? cabLen : 3);
      // Double-deck cars with two doors have their vestibules near the car ends; otherwise doors are evenly spread.
      const centres =
        model.levels === 2 && model.doorsPerCar === 2
          ? [a + (b - a) * 0.14, b - (b - a) * 0.14]
          : Array.from({ length: model.doorsPerCar }, (_, k) => a + ((b - a) * (k + 0.5)) / model.doorsPerCar);
      const doors = centres.map((c) => c - doorW / 2);
      const bays: Pane[] = [];
      let from = a;
      for (const d of doors) {
        bays.push(...split(from, d - 2));
        from = d + doorW + 2;
      }
      bays.push(...split(from, b));
      const long = w > 40;
      const axles =
        model.mode === 'tram'
          ? long || model.cars % 2 === 0
            ? [x + w / 2 - 5, x + w / 2 + 5]
            : []
          : w < 30
            ? [x + 5, x + w - 5]
            : [x + 6, x + 12, x + w - 12, x + w - 6];
      const pantoCar = model.mode === 'tram' ? Math.floor(model.cars / 2) : Math.min(1, model.cars - 1);
      cars.push({ x, w, cabLeft, cabRight, doors, bays, axles, pantograph: model.mode !== 'metro' && i === pantoCar });
      x += w + (cabRight ? UNIT_GAP : CAR_GAP);
    }
  }
  const viewW = x - UNIT_GAP + MARGIN;

  const windowRows =
    model.levels === 2
      ? [
          { y: bodyY + 3.5, h: bodyH * 0.27 },
          { y: bodyY + bodyH * 0.43, h: bodyH * 0.25 },
        ]
      : [{ y: bodyY + 4, h: bodyH * 0.38 }];
  const doorTop = model.levels === 2 ? bodyY + bodyH * 0.3 : bodyY + 2.5;
  return { model, cars, viewW, bodyY, bodyH, bodyBottom, doorW, doorTop, cabLen, noseInset: inset, windowRows };
}

type Pt = { dx: number; dy: number; c?: { dx: number; dy: number } };

/** One car end from the roof (start) down to the floor, as distances from that end of the car. */
function endPoints(cab: boolean, nose: NoseShape, h: number): Pt[] {
  if (!cab) return [{ dx: 2, dy: 0 }, { dx: 0, dy: 2, c: { dx: 0, dy: 0 } }, { dx: 0, dy: h }];
  const s = noseInset(nose, h);
  switch (nose) {
    case 'rounded':
      return [{ dx: s, dy: 0 }, { dx: 0, dy: s * 0.95, c: { dx: 0, dy: 0 } }, { dx: 0, dy: h }];
    case 'sloped':
      return [{ dx: s, dy: 0 }, { dx: 0, dy: h * 0.62, c: { dx: s * 0.18, dy: h * 0.1 } }, { dx: 0, dy: h }];
    case 'tram':
      return [{ dx: s, dy: 0 }, { dx: 0, dy: h * 0.5, c: { dx: 0.6, dy: 0.6 } }, { dx: 0.6, dy: h - 2 }, { dx: 2.5, dy: h, c: { dx: 0.6, dy: h } }];
    default:
      return [{ dx: s, dy: 0 }, { dx: 0, dy: s, c: { dx: 0, dy: 0 } }, { dx: 0, dy: h }];
  }
}

/** Closed outline of one car body: its cab ends take the model's nose shape. */
export function carOutline(car: ProfileCar, p: TrainProfile): string {
  const h = p.bodyH;
  const y = p.bodyY;
  const left = endPoints(car.cabLeft, p.model.nose, h);
  const right = endPoints(car.cabRight, p.model.nose, h);
  const L = (pt: { dx: number; dy: number }) => `${(car.x + pt.dx).toFixed(2)} ${(y + pt.dy).toFixed(2)}`;
  const R = (pt: { dx: number; dy: number }) => `${(car.x + car.w - pt.dx).toFixed(2)} ${(y + pt.dy).toFixed(2)}`;
  // Left end walked upwards: from the floor point back to the roof point, each curve keeping its control.
  const d = [`M${L(left[left.length - 1])}`];
  for (let k = left.length - 1; k > 0; k--) {
    const to = left[k - 1];
    const c = left[k].c;
    d.push(c ? `Q${L(c)} ${L(to)}` : `L${L(to)}`);
  }
  d.push(`L${R(right[0])}`);
  for (let k = 1; k < right.length; k++) {
    const c = right[k].c;
    d.push(c ? `Q${R(c)} ${R(right[k])}` : `L${R(right[k])}`);
  }
  d.push('Z');
  return d.join(' ');
}

/** Number of coupled units: SNCF says « long » for a double unit. */
export const runUnits = (run: Pick<VehicleRun, 'length'>): 1 | 2 => (run.length === 'long' ? 2 : 1);

/** « QIWI · train 137594 », each part only when the feed gives it; null when neither is known (RATP runs). */
export function missionText(run: Pick<VehicleRun, 'mission' | 'trainNumber'>): string | null {
  const parts = [run.mission || null, run.trainNumber ? `train ${run.trainNumber}` : null].filter((s): s is string => s !== null);
  return parts.length > 0 ? parts.join(' · ') : null;
}
