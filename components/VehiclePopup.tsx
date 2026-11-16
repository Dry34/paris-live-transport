import type { LineInfo } from '@/lib/types';
import type { RunPosition } from '@/lib/client/interpolate';
import { LineBadge, lineName } from './LineBadge';

export interface VehiclePopupProps {
  line: LineInfo;
  destination: string;
  position: RunPosition;
  nextStopName: string | null;
  now: number;
}

export function minutesUntil(time: number, now: number): string {
  const min = Math.round((time - now) / 60_000);
  return min < 1 ? 'dans moins d’1 min' : `dans ${min} min`;
}

export function VehiclePopup({ line, destination, position, nextStopName, now }: VehiclePopupProps) {
  const { state, nextTime } = position;
  let nextLine: string | null = null;
  if (nextStopName) {
    if (state === 'moving') nextLine = `Prochaine station : ${nextStopName}`;
    else if (state === 'waiting') nextLine = `Au départ de ${nextStopName}`;
    else nextLine = `À quai : ${nextStopName}`;
  }
  let when: string | null = null;
  if (nextTime !== null) when = state === 'moving' ? minutesUntil(nextTime, now) : `départ ${minutesUntil(nextTime, now)}`;

  return (
    <div className="vehicle-popup">
      <div className="vehicle-popup-head">
        <LineBadge line={line} size="lg" />
        <div>
          <span className="sr-only">{lineName(line)} </span>
          <p className="vehicle-popup-dest">vers {destination}</p>
        </div>
      </div>
      {nextLine && (
        <p className="vehicle-popup-next">
          {nextLine}
          {when && <strong> {when}</strong>}
        </p>
      )}
      <p className="vehicle-popup-note">Position estimée d’après les horaires temps réel</p>
    </div>
  );
}
