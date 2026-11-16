import type { ReactNode } from 'react';
import type { Mode } from '@/lib/types';

// Side view of a train in the line's colour, one silhouette per mode, heading right. Generic shapes only: no
// rolling-stock model is implied.

interface Spec {
  /** Car lengths, left to right (viewBox units). */
  cars: number[];
  /** Body height. */
  height: number;
  /** Window rows (1, or 2 for double-deck). */
  decks: 1 | 2;
  /** Gap between cars (articulations are drawn as a dark bellows). */
  gap: number;
  pantograph: boolean;
  /** Window width and spacing. */
  win: number;
  pitch: number;
}

const SPECS: Record<Mode, Spec> = {
  metro: { cars: [56, 56, 56, 56, 56], height: 22, decks: 1, gap: 3, pantograph: false, win: 9, pitch: 14 },
  rer: { cars: [74, 74, 74, 74], height: 30, decks: 2, gap: 3, pantograph: true, win: 10, pitch: 14 },
  tram: { cars: [62, 34, 62, 34, 62], height: 22, decks: 1, gap: 4, pantograph: true, win: 14, pitch: 19 },
  transilien: { cars: [72, 72, 72, 72], height: 26, decks: 1, gap: 3, pantograph: true, win: 13, pitch: 18 },
};

const VIEW_H = 48;
const RAIL_Y = 44;
const WINDOW = '#1b2230';

const noseRadius = (h: number) => Math.min(h * 0.55, 14);

/** Car outline with an optional rounded nose on either end. */
function carPath(x: number, y: number, w: number, h: number, noseLeft: boolean, noseRight: boolean): string {
  const nose = noseRadius(h);
  const rl = noseLeft ? nose : 3;
  const rr = noseRight ? nose : 3;
  return [
    `M${x} ${y + h}`,
    `L${x} ${y + rl} Q${x} ${y} ${x + rl} ${y}`,
    `L${x + w - rr} ${y} Q${x + w} ${y} ${x + w} ${y + rr}`,
    `L${x + w} ${y + h} Z`,
  ].join(' ');
}

export function TrainIllustration({ mode, color }: { mode: Mode; color: string }) {
  const spec = SPECS[mode];
  const total = spec.cars.reduce((a, b) => a + b, 0) + spec.gap * (spec.cars.length - 1);
  const wheelR = 3;
  const bodyBottom = RAIL_Y - wheelR * 2 - (mode === 'tram' ? 0 : 1);
  const y = bodyBottom - spec.height;
  const viewW = total + 8;
  const parts: ReactNode[] = [];
  let x = 4;
  spec.cars.forEach((w, i) => {
    const first = i === 0;
    const last = i === spec.cars.length - 1;
    const key = `c${i}`;
    if (i > 0) parts.push(<rect key={`g${i}`} x={x - spec.gap} y={y + 4} width={spec.gap} height={spec.height - 7} fill={WINDOW} opacity={0.7} />);
    parts.push(<path key={key} d={carPath(x, y, w, spec.height, first, last)} fill={color} />);
    // Roof shade and underframe give the body some volume whatever the line colour.
    const roofL = first ? noseRadius(spec.height) : 3;
    const roofR = last ? noseRadius(spec.height) : 3;
    parts.push(<rect key={`${key}r`} x={x + roofL} y={y} width={w - roofL - roofR} height={2} fill="#000" opacity={0.18} />);
    parts.push(<rect key={`${key}u`} x={x + 1} y={bodyBottom - 3} width={w - 2} height={3} fill="#000" opacity={0.22} />);
    // Windows, kept clear of the noses and the doors' rhythm.
    const inset = first || last ? 15 : 6;
    const rows = spec.decks === 2 ? [y + 5, y + spec.height / 2 + 1] : [y + 5];
    const winH = spec.decks === 2 ? spec.height / 2 - 7 : spec.height * 0.42;
    rows.forEach((wy, row) => {
      for (let wx = x + inset; wx + spec.win <= x + w - inset; wx += spec.pitch) {
        parts.push(<rect key={`${key}w${row}-${wx}`} x={wx} y={wy} width={spec.win} height={winH} rx={1.5} fill={WINDOW} opacity={0.88} />);
      }
    });
    // Windscreen on the leading and trailing ends.
    if (last) parts.push(<rect key={`${key}f`} x={x + w - 11} y={y + 5} width={7} height={spec.height * 0.42} rx={2} fill={WINDOW} />);
    if (first) parts.push(<rect key={`${key}b`} x={x + 4} y={y + 5} width={7} height={spec.height * 0.42} rx={2} fill={WINDOW} />);
    // Bogies (trams: one under each long module).
    const axles = mode === 'tram' ? (w > 40 ? [x + w / 2 - 7, x + w / 2 + 7] : []) : [x + 9, x + 17, x + w - 17, x + w - 9];
    axles.forEach((ax, k) => parts.push(<circle key={`${key}a${k}`} cx={ax} cy={RAIL_Y - wheelR} r={wheelR} fill={WINDOW} />));
    if (spec.pantograph && (mode === 'tram' ? i === 2 : i === 1)) {
      const px = x + w / 2;
      parts.push(
        <path
          key={`${key}p`}
          d={`M${px - 5} ${y} L${px} ${y - 4} L${px - 4} ${y - 7} M${px - 9} ${y - 7} L${px + 3} ${y - 7}`}
          stroke={WINDOW}
          strokeWidth={1.4}
          fill="none"
          strokeLinecap="round"
        />,
      );
    }
    x += w + spec.gap;
  });

  return (
    <svg className="train-illustration" viewBox={`0 0 ${viewW} ${VIEW_H}`} width="100%" height={VIEW_H} preserveAspectRatio="xMidYMax meet" aria-hidden="true">
      <line x1={0} x2={viewW} y1={RAIL_Y + 0.75} y2={RAIL_Y + 0.75} stroke="currentColor" strokeWidth={1.5} opacity={0.35} />
      {parts}
    </svg>
  );
}
