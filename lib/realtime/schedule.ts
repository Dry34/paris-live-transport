// Service window, Paris calendar day and polling backoff (pure functions).

const MAX_DELAY_MS = 15 * 60_000;
const WINDOW_CLOSE_MIN = 90; // 01:30 Paris
const WINDOW_OPEN_MIN = 300; // 05:00 Paris

const parisFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Paris',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function parisParts(now: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of parisFmt.formatToParts(now)) out[p.type] = p.value;
  return out;
}

/** Calendar day in Europe/Paris, `YYYY-MM-DD`. */
export function parisDay(now: number): string {
  const p = parisParts(now);
  return `${p.year}-${p.month}-${p.day}`;
}

/** True from 05:00 to 01:30 the next day (Paris time); false between 01:30 and 05:00. */
export function inServiceWindow(now: number): boolean {
  const p = parisParts(now);
  const minutes = Number(p.hour) * 60 + Number(p.minute);
  return minutes < WINDOW_CLOSE_MIN || minutes >= WINDOW_OPEN_MIN;
}

/**
 * Delay before the next call, or null when no call may be made (cap reached or outside the service
 * window). Backoff: `intervalMs × 2^failures` after the last call, the delay never exceeding 15 min.
 */
export function nextDelayMs(
  now: number,
  s: { lastFetch: number | null; failures: number; callsToday: number; intervalMs: number; cap: number },
): number | null {
  if (s.callsToday >= s.cap || !inServiceWindow(now)) return null;
  if (s.lastFetch === null) return 0;
  const wait = Math.min(s.intervalMs * 2 ** s.failures, MAX_DELAY_MS);
  return Math.min(Math.max(0, s.lastFetch + wait - now), MAX_DELAY_MS);
}
