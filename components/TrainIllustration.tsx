import { useId, type ReactNode } from 'react';
import type { Mode } from '@/lib/types';
import type { RollingStockModel } from '@/lib/rollingStock';
import { carOutline, trainProfile, RAIL_Y as PROFILE_RAIL_Y, VIEW_H as PROFILE_VIEW_H, WHEEL_R, type ProfileCar, type TrainProfile } from '@/lib/client/trainProfile';

// Side view of a train, heading right. With a catalogue model: its real profile (nose, cars, decks, doors) in its
// livery. Without one: a generic silhouette of the mode in the line's colour, implying no model.

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

function GenericTrain({ mode, color }: { mode: Mode; color: string }) {
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

const RUNNING_GEAR = '#2b323b';

/** One car painted in the livery, every layer clipped to the body outline. */
function Car({ car, p, clip }: { car: ProfileCar; p: TrainProfile; clip: string }) {
  const { livery } = p.model;
  const { bodyY: y, bodyH: h, bodyBottom, doorW, doorTop, cabLen, windowRows } = p;
  const outline = carOutline(car, p);
  const lastRow = windowRows[windowRows.length - 1];
  const bandY = lastRow.y + lastRow.h + 1.4;
  const skirtY = y + h * 0.8;
  const maskBottom = y + (p.model.levels === 2 ? h * 0.56 : h * 0.66);
  const glassBottom = y + (p.model.levels === 2 ? h * 0.42 : h * 0.5);
  // Cab ends: front mask framed in the band colour, windscreen inside.
  const FRAME = 1.4;
  const maskW = cabLen - 1;
  const maskH = maskBottom - y;
  // Cab ends: front mask framed in the band colour on its inner side and bottom, windscreen inside. Shapes run
  // past the car end and the roof; the body clip trims them to the nose.
  const cabs = [
    ...(car.cabLeft ? [{ key: 'l', outer: car.x - 3, glass: car.x + 1 }] : []),
    ...(car.cabRight ? [{ key: 'r', outer: car.x + car.w - maskW, glass: car.x + car.w - maskW + 3 }] : []),
  ];
  return (
    <g>
      <clipPath id={clip}>
        <path d={outline} />
      </clipPath>
      <path d={outline} fill={livery.body} />
      <g clipPath={`url(#${clip})`}>
        <rect x={car.x} y={y} width={car.w} height={1.6} fill="#000" opacity={0.12} />
        <rect x={car.x} y={skirtY} width={car.w} height={bodyBottom - skirtY} fill={livery.skirt} />
        <rect x={car.x} y={bandY} width={car.w} height={1.7} fill={livery.band} />
        {windowRows.map((row, r) => car.bays.map((b) => <rect key={`w${r}-${b.x.toFixed(1)}`} x={b.x} y={row.y} width={b.w} height={row.h} rx={1.2} fill={livery.window} />))}
        {car.doors.map((d) => (
          <g key={`d${d.toFixed(1)}`}>
            <rect x={d} y={doorTop} width={doorW} height={bodyBottom - doorTop - 0.4} rx={0.8} fill={livery.door} />
            <rect x={d + 1.2} y={doorTop + 2} width={doorW - 2.4} height={(bodyBottom - doorTop) * 0.42} rx={0.6} fill={livery.window} />
          </g>
        ))}
        {cabs.map((c) => (
          <g key={c.key}>
            <rect x={c.outer} y={y - 1} width={maskW + 3} height={maskH + 1 + FRAME} fill={livery.band} />
            <rect x={c.key === 'l' ? c.outer : c.outer + FRAME} y={y - 1} width={maskW + 3 - FRAME} height={maskH + 1} rx={1.5} fill={livery.front} />
            <rect x={c.glass} y={y + 2.5} width={maskW - 5} height={glassBottom - y - 2.5} rx={1.5} fill={livery.window} opacity={0.92} />
          </g>
        ))}
      </g>
      <path d={outline} fill="none" stroke="currentColor" strokeOpacity={0.55} strokeWidth={0.6} />
    </g>
  );
}

function RealTrain({ model, units }: { model: RollingStockModel; units: number }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const p = trainProfile(model, units)!;
  const parts: ReactNode[] = [];
  p.cars.forEach((car, i) => {
    const next = p.cars[i + 1];
    if (next) {
      // Gangway between cars, coupler between units.
      parts.push(
        car.cabRight ? (
          <rect key={`k${i}`} x={car.x + car.w} y={p.bodyBottom - 5} width={next.x - car.x - car.w} height={1.8} fill={RUNNING_GEAR} />
        ) : (
          <rect key={`k${i}`} x={car.x + car.w - 0.5} y={p.bodyY + 4} width={next.x - car.x - car.w + 1} height={p.bodyH - 7} fill={RUNNING_GEAR} opacity={0.75} />
        ),
      );
    }
    if (car.pantograph) {
      const px = car.x + car.w / 2;
      const y = p.bodyY;
      parts.push(
        <path
          key={`p${i}`}
          d={`M${px - 5} ${y} L${px} ${y - 4} L${px - 4} ${y - 7} M${px - 9} ${y - 7} L${px + 3} ${y - 7}`}
          stroke={RUNNING_GEAR}
          strokeWidth={1.2}
          fill="none"
          strokeLinecap="round"
        />,
      );
    }
    car.axles.forEach((ax, k) => parts.push(<circle key={`a${i}-${k}`} cx={ax} cy={PROFILE_RAIL_Y - WHEEL_R} r={WHEEL_R} fill={RUNNING_GEAR} />));
    parts.push(<Car key={`c${i}`} car={car} p={p} clip={`${id}-c${i}`} />);
  });
  return (
    <svg
      className="train-illustration"
      viewBox={`0 0 ${p.viewW.toFixed(2)} ${PROFILE_VIEW_H}`}
      width="100%"
      height={PROFILE_VIEW_H}
      preserveAspectRatio="xMidYMax meet"
      aria-hidden="true"
    >
      {/* Rail drawn past the viewBox so it spans the card whatever the train's length. */}
      <line x1={-2000} x2={p.viewW + 2000} y1={PROFILE_RAIL_Y + 0.75} y2={PROFILE_RAIL_Y + 0.75} stroke="currentColor" strokeWidth={1.5} opacity={0.35} />
      {parts}
    </svg>
  );
}

export function TrainIllustration({ mode, color, model, units = 1 }: { mode: Mode; color: string; model?: RollingStockModel | null; units?: number }) {
  return model ? <RealTrain model={model} units={units} /> : <GenericTrain mode={mode} color={color} />;
}
