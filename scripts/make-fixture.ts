// Réduit une réponse PRIM estimated-timetable brute à nos lignes ciblées.
// Usage : tsx scripts/make-fixture.ts <raw.json> <out.json>
import { readFileSync, writeFileSync } from 'node:fs';
import { isTargetLine } from '../lib/lines';

const MAX_JOURNEYS_PER_LINE = 6;

type RawJourney = { LineRef?: { value?: unknown } } & Record<string, unknown>;
interface RawResponse {
  Siri: {
    ServiceDelivery: {
      EstimatedTimetableDelivery?: { EstimatedJourneyVersionFrame?: { EstimatedVehicleJourney?: RawJourney[] }[] }[];
    };
  };
}

function lineIdOf(journey: RawJourney): string | null {
  const ref: unknown = journey?.LineRef?.value;
  if (typeof ref !== 'string') return null;
  return /^STIF:Line::([^:]+):$/.exec(ref)?.[1] ?? null;
}

export function reduceResponse(raw: RawResponse): RawResponse {
  const perLine = new Map<string, number>();
  const delivery = raw.Siri.ServiceDelivery;
  for (const d of delivery.EstimatedTimetableDelivery ?? []) {
    for (const frame of d.EstimatedJourneyVersionFrame ?? []) {
      frame.EstimatedVehicleJourney = (frame.EstimatedVehicleJourney ?? []).filter((j) => {
        const id = lineIdOf(j);
        if (!id || !isTargetLine(id)) return false;
        const n = perLine.get(id) ?? 0;
        if (n >= MAX_JOURNEYS_PER_LINE) return false;
        perLine.set(id, n + 1);
        return true;
      });
    }
  }
  return raw;
}

if (process.argv[1] && /make-fixture\.ts$/.test(process.argv[1])) {
  const [, , input, output] = process.argv;
  if (!input || !output) {
    console.error('Usage : tsx scripts/make-fixture.ts <raw.json> <out.json>');
    process.exit(1);
  }
  const reduced = reduceResponse(JSON.parse(readFileSync(input, 'utf8')));
  writeFileSync(output, JSON.stringify(reduced));
  console.log(`Fixture écrite : ${output}`);
}
