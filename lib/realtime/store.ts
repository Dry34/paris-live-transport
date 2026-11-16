// Persistence in .cache/: call budget, last estimated-timetable snapshot, last disruptions.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Disruption, Journey, VehicleRun } from '../types';
import { parisDay } from './schedule';

export type CallKind = 'et' | 'disruptions';
export interface Budget { day: string; calls: Record<CallKind, number> }
export interface StoredSnapshot { fetchedAt: number; journeys: Journey[]; runs: VehicleRun[] }
export interface StoredDisruptions { fetchedAt: number; disruptions: Disruption[] }

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

/** Atomic write: temporary file in the same directory, then rename over the target. */
function writeJson(dir: string, name: string, value: unknown): void {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  writeFileSync(tmp, JSON.stringify(value));
  renameSync(tmp, file);
}

export function loadBudget(dir: string): Budget {
  const b = readJson<Partial<Budget>>(path.join(dir, 'budget.json'));
  return {
    day: typeof b?.day === 'string' ? b.day : '',
    calls: { et: Number(b?.calls?.et) || 0, disruptions: Number(b?.calls?.disruptions) || 0 },
  };
}

/** Calls already made today (Paris day of `now`) for `kind`. */
export function callsToday(dir: string, kind: CallKind, now: number): number {
  const b = loadBudget(dir);
  return b.day === parisDay(now) ? b.calls[kind] : 0;
}

/** Counts one call; the counters restart when the Paris calendar day changes. */
export function recordCall(dir: string, kind: CallKind, now: number): Budget {
  const today = parisDay(now);
  const b = loadBudget(dir);
  const next: Budget = b.day === today ? b : { day: today, calls: { et: 0, disruptions: 0 } };
  next.calls[kind] += 1;
  writeJson(dir, 'budget.json', next);
  return next;
}

export function loadSnapshot(dir: string): StoredSnapshot | null {
  const s = readJson<StoredSnapshot>(path.join(dir, 'snapshot.json'));
  return s && typeof s.fetchedAt === 'number' && Array.isArray(s.runs) && Array.isArray(s.journeys) ? s : null;
}

export function saveSnapshot(dir: string, s: StoredSnapshot): void {
  writeJson(dir, 'snapshot.json', s);
}

export function loadDisruptions(dir: string): StoredDisruptions | null {
  const d = readJson<StoredDisruptions>(path.join(dir, 'disruptions.json'));
  return d && typeof d.fetchedAt === 'number' && Array.isArray(d.disruptions) ? d : null;
}

export function saveDisruptions(dir: string, d: StoredDisruptions): void {
  writeJson(dir, 'disruptions.json', d);
}
