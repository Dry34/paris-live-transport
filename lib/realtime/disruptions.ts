// Parsing of PRIM `disruptions_bulk/disruptions/v2`, restricted to the targeted lines and to disruptions active now.
//
// Real response shape (captured 2026-11-16, 853 disruptions, 762 lines, ~230 kB):
//   {
//     disruptions: [{
//       id: "8e9e08e6-...",                       // uuid
//       applicationPeriods: [{ begin, end }],     // "YYYYMMDDTHHMMSS", Europe/Paris local time, no offset
//       lastUpdate: "20261001T145848",            // same format
//       cause: "TRAVAUX" | "INFORMATION" | ...,
//       severity: "BLOQUANTE" | "PERTURBEE" | "INFORMATION",
//       title: "RER C : Pont de Rungis ...",
//       message: "<p>P&#233;riode : ...</p>",     // HTML with numeric entities
//       shortMessage?: string,
//       impactedSections?: [{ lineId: "line:IDFM:C01727", from, to }]
//     }],
//     lines: [{
//       id: "line:IDFM:C01374", name, shortName, mode: "Metro" | "Bus" | ..., networkId,
//       impactedObjects: [{ type: "line" | "stop_point" | "network" | ..., id, name, disruptionIds: [uuid] }]
//     }],
//     lastUpdatedDate: "2026-11-16T11:43:15.788Z"
//   }
// A disruption is linked to a line through lines[].impactedObjects[].disruptionIds (any object type: a stop_point
// impact is listed under each line serving it) and through its own impactedSections[].lineId.
import { isTargetLine } from '../lines';
import type { Disruption } from '../types';

const SEVERITY_RANK: Record<string, number> = { BLOQUANTE: 0, PERTURBEE: 1, INFORMATION: 2 };

const parisOffsetFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Paris',
  hourCycle: 'h23',
  year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
});

/** Epoch ms of a Paris wall-clock time given as UTC fields. */
function parisWallToEpoch(y: number, mo: number, d: number, h: number, mi: number, s: number): number {
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  const offsetAt = (t: number): number => {
    const p: Record<string, number> = {};
    for (const part of parisOffsetFmt.formatToParts(t)) if (part.type !== 'literal') p[part.type] = Number(part.value);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(t / 1000) * 1000;
  };
  // Two passes settle the offset around DST changes.
  let t = asUtc - offsetAt(asUtc);
  t = asUtc - offsetAt(t);
  return t;
}

/** "20261112T230000" (Paris local) -> epoch ms, NaN when malformed. */
export function parsePrimDate(s: unknown): number {
  const m = typeof s === 'string' ? /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/.exec(s) : null;
  if (!m) return NaN;
  const [y, mo, d, h, mi, sec] = m.slice(1).map(Number);
  return parisWallToEpoch(y, mo, d, h, mi, sec);
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '‹', gt: '›', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»' };

/** HTML -> plain text: line breaks kept, tags removed, entities decoded. */
export function htmlToText(html: string): string {
  return html
    .replace(/<\s*(br|\/p|\/li|\/div)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/[<>]/g, '')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** "line:IDFM:C01371" / "IDFM:C01371" / "C01371" -> "C01371". */
function bareLineId(id: unknown): string | null {
  const m = typeof id === 'string' ? /(?:^|:)(C\d{5})$/.exec(id) : null;
  return m ? m[1] : null;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

export function parseDisruptions(raw: unknown, now: number): Disruption[] {
  if (!isObj(raw) || !Array.isArray(raw.disruptions)) return [];

  // disruption id -> targeted line ids
  const linesOf = new Map<string, Set<string>>();
  const link = (disruptionId: unknown, lineId: unknown) => {
    const line = bareLineId(lineId);
    if (typeof disruptionId !== 'string' || !line || !isTargetLine(line)) return;
    let set = linesOf.get(disruptionId);
    if (!set) linesOf.set(disruptionId, (set = new Set()));
    set.add(line);
  };
  if (Array.isArray(raw.lines)) {
    for (const l of raw.lines) {
      if (!isObj(l) || !Array.isArray(l.impactedObjects)) continue;
      for (const o of l.impactedObjects) {
        if (isObj(o) && Array.isArray(o.disruptionIds)) for (const id of o.disruptionIds) link(id, l.id);
      }
    }
  }

  const out: { d: Disruption; rank: number; updated: number }[] = [];
  for (const item of raw.disruptions) {
    if (!isObj(item) || typeof item.id !== 'string') continue;
    if (Array.isArray(item.impactedSections)) {
      for (const s of item.impactedSections) if (isObj(s)) link(item.id, s.lineId);
    }
    const lineIds = linesOf.get(item.id);
    if (!lineIds || !Array.isArray(item.applicationPeriods)) continue;

    const periods = item.applicationPeriods
      .filter(isObj)
      .map((p) => ({ begin: parsePrimDate(p.begin), end: parsePrimDate(p.end) }))
      .filter((p) => Number.isFinite(p.begin) && Number.isFinite(p.end));
    if (!periods.some((p) => p.begin <= now && now <= p.end)) continue;

    const severity = typeof item.severity === 'string' ? item.severity : 'INFORMATION';
    const updated = parsePrimDate(item.lastUpdate);
    out.push({
      d: {
        id: item.id,
        lineIds: [...lineIds].sort(),
        title: htmlToText(typeof item.title === 'string' ? item.title : ''),
        message: htmlToText(typeof item.message === 'string' ? item.message : ''),
        severity,
        periods,
      },
      rank: SEVERITY_RANK[severity] ?? 3,
      updated: Number.isFinite(updated) ? updated : 0,
    });
  }
  // Most severe first, then most recently updated.
  return out.sort((a, b) => a.rank - b.rank || b.updated - a.updated).map((x) => x.d);
}

/** True when one of the disruption's periods contains `now`. */
export function isActiveAt(d: Disruption, now: number): boolean {
  return d.periods.some((p) => p.begin <= now && now <= p.end);
}
