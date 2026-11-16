// Step 6 invariants of the generated network.json (run by scripts/check-data.ts and tests).
import type { Network } from '../types';
import { TARGET_LINE_IDS } from '../lines';

export interface Check { ok: boolean; label: string }

const LINE_1 = 'C01371';
const RER_A = 'C01742';
const LINE_J = 'C01739';
const LINE_L = 'C01740';
const MAX_BYTES = 8e6;

/** Quay ids (without prefix) called by target-line journeys of a SIRI EstimatedTimetable response. */
export function siriQuaysOfTargetLines(et: unknown): Set<string> {
  const out = new Set<string>();
  const deliveries = (et as { Siri?: { ServiceDelivery?: { EstimatedTimetableDelivery?: unknown[] } } })?.Siri?.ServiceDelivery
    ?.EstimatedTimetableDelivery ?? [];
  for (const d of deliveries as { EstimatedJourneyVersionFrame?: { EstimatedVehicleJourney?: unknown[] }[] }[]) {
    for (const f of d.EstimatedJourneyVersionFrame ?? []) {
      for (const j of (f.EstimatedVehicleJourney ?? []) as {
        LineRef?: { value?: string };
        EstimatedCalls?: { EstimatedCall?: { StopPointRef?: { value?: string } }[] };
      }[]) {
        const line = /::(C\d+):/.exec(j.LineRef?.value ?? '')?.[1];
        if (!line || !TARGET_LINE_IDS.has(line)) continue;
        for (const c of j.EstimatedCalls?.EstimatedCall ?? []) {
          const q = /:Q:([^:]+):/.exec(c.StopPointRef?.value ?? '')?.[1];
          if (q) out.add(`${line} ${q}`);
        }
      }
    }
  }
  return out;
}

export function checkNetwork(net: Network, sizeBytes: number, et: unknown): Check[] {
  const checks: Check[] = [];
  const add = (ok: boolean, label: string) => checks.push({ ok, label });
  const lineIds = Object.keys(net.lines);
  const pats = (id: string, dir?: 0 | 1) => net.patterns.filter((p) => p.lineId === id && (dir === undefined || p.directionId === dir));

  add(lineIds.length === TARGET_LINE_IDS.size && lineIds.every((id) => TARGET_LINE_IDS.has(id)), `${lineIds.length} lignes (attendu ${TARGET_LINE_IDS.size})`);
  const few = lineIds.filter((id) => pats(id).length < 2);
  add(few.length === 0, `chaque ligne a >= 2 patterns${few.length ? ` (sauf ${few.join(', ')})` : ''}`);
  const l1 = Object.values(net.stations).filter((s) => s.lines.includes(LINE_1)).length;
  add(l1 === 25, `ligne 1 : ${l1} stations (attendu 25)`);
  const a0 = pats(RER_A, 0).length;
  const a1 = pats(RER_A, 1).length;
  add(a0 >= 4 && a1 >= 4, `RER A >= 4 patterns/direction (${a0} / ${a1})`);
  add(pats(LINE_J).length > 0 && pats(LINE_L).length > 0, `J (${pats(LINE_J).length}) et L (${pats(LINE_L).length}) ont des patterns`);

  const segs = Object.entries(net.segments);
  const straight = segs.filter(([k, s]) => {
    if (s.coords.length !== 2) return false;
    const [a, b] = k.split('>').map((id) => net.quays[id]);
    return !!a && !!b && s.coords[0][0] === a.lon && s.coords[0][1] === a.lat && s.coords[1][0] === b.lon && s.coords[1][1] === b.lat;
  }).length;
  const pct = segs.length ? (100 * straight) / segs.length : 100;
  add(pct < 5, `fallback droit ${straight}/${segs.length} = ${pct.toFixed(2)} % (< 5 %)`);

  const missingSeg = net.patterns.flatMap((p) => p.quays.slice(1).map((q, i) => `${p.quays[i]}>${q}`)).filter((k) => !net.segments[k]);
  const missingQuay = net.patterns.flatMap((p) => p.quays).filter((q) => !net.quays[q]);
  add(missingSeg.length === 0 && missingQuay.length === 0, `patterns complets (segments manquants ${missingSeg.length}, quays manquants ${missingQuay.length})`);
  const badSeg = segs.filter(([, s]) => s.coords.length < 2 || !(s.seconds > 0)).length;
  add(badSeg === 0, `segments valides (>= 2 coords, seconds > 0) : ${badSeg} invalides`);

  add(sizeBytes < MAX_BYTES, `taille ${(sizeBytes / 1e6).toFixed(2)} Mo (< 8 Mo)`);

  const siri = [...siriQuaysOfTargetLines(et)];
  const missing = siri.filter((lq) => !net.quays[lq.split(' ')[1]]);
  const cov = siri.length ? (100 * (siri.length - missing.length)) / siri.length : 0;
  add(cov >= 98, `quays SIRI couverts ${siri.length - missing.length}/${siri.length} (${cov.toFixed(2)} %)${missing.length ? ` manquants: ${missing.join(', ')}` : ''}`);
  return checks;
}
