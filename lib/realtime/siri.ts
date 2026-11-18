// Parsing of a PRIM SIRI-Lite estimated-timetable response into target-line journeys.
import type { Journey } from '../types';
import { isTargetLine } from '../lines';

type Val = { value?: unknown } | undefined;
type Raw = Record<string, unknown>;

const str = (v: Val): string => (typeof v?.value === 'string' ? v.value : '');
const first = (v: unknown): string => (Array.isArray(v) ? str(v[0] as Val) : '');
const obj = (v: unknown): Raw => (v && typeof v === 'object' ? (v as Raw) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function time(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

const quayOf = (ref: string): string | null => /:Q:([^:]+):/.exec(ref)?.[1] ?? null;
// SNCF journeys reference the stop place; the GTFS (hence network.quays) names it "monomodalStopPlace:N".
const stopPlaceOf = (ref: string): string | null => {
  const sp = /:SP:([^:]+):/.exec(ref)?.[1];
  return sp ? `monomodalStopPlace:${sp}` : null;
};

/** Network quay id of a call: StopPointRef quay (RATP…) or stop place (SNCF), else the assigned quay. */
function callQuay(c: Raw): string | null {
  const ref = str(c.StopPointRef as Val);
  return (
    quayOf(ref) ??
    stopPlaceOf(ref) ??
    quayOf(str(obj(c.DepartureStopAssignment).ExpectedQuayRef as Val)) ??
    quayOf(str(obj(c.ArrivalStopAssignment).ExpectedQuayRef as Val))
  );
}

function operatorOf(j: Raw): Journey['operator'] {
  const s = `${str(j.OperatorRef as Val)} ${str(j.DatedVehicleJourneyRef as Val)}`;
  if (s.includes('RATP')) return 'RATP';
  if (s.includes('SNCF')) return 'SNCF';
  return 'OTHER';
}

function delta(exp: unknown, aimed: unknown): number | null {
  const e = time(exp);
  const t = time(aimed);
  return e !== null && t !== null ? Math.round((e - t) / 1000) : null;
}

function parseJourney(j: Raw): Journey | null {
  const lineId = /::(C\d+):/.exec(str(j.LineRef as Val))?.[1];
  if (!lineId || !isTargetLine(lineId)) return null;
  const calls: Journey['calls'] = [];
  for (const raw of arr(obj(j.EstimatedCalls).EstimatedCall)) {
    const c = obj(raw);
    const quay = callQuay(c);
    const a = time(c.ExpectedArrivalTime) ?? time(c.AimedArrivalTime);
    const d = time(c.ExpectedDepartureTime) ?? time(c.AimedDepartureTime);
    if (!quay || (a === null && d === null)) continue;
    const delaySec =
      delta(c.ExpectedArrivalTime, c.AimedArrivalTime) ?? delta(c.ExpectedDepartureTime, c.AimedDepartureTime);
    calls.push({ quay, arr: a, dep: d, delaySec });
  }
  if (calls.length === 0) return null;
  calls.sort((x, y) => (x.arr ?? x.dep!) - (y.arr ?? y.dep!));
  return {
    ref: str(j.DatedVehicleJourneyRef as Val),
    lineId,
    direction: str(j.DirectionRef as Val),
    destination: first(j.DestinationName) || first(j.DestinationShortName) || first(j.DirectionName),
    operator: operatorOf(j),
    calls,
  };
}

export function parseEstimatedTimetable(raw: unknown): { responseTime: number; journeys: Journey[] } {
  const sd = obj(obj(obj(raw).Siri).ServiceDelivery);
  const responseTime = time(sd.ResponseTimestamp) ?? 0;
  const journeys: Journey[] = [];
  const delivery = obj(arr(sd.EstimatedTimetableDelivery)[0]);
  for (const frame of arr(delivery.EstimatedJourneyVersionFrame)) {
    for (const j of arr(obj(frame).EstimatedVehicleJourney)) {
      const parsed = parseJourney(obj(j));
      if (parsed) journeys.push(parsed);
    }
  }
  return { responseTime, journeys };
}
