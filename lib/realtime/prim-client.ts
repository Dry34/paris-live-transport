// PRIM (IDFM marketplace) HTTP client. Server-side only: the API key never reaches the browser.

const BASE = 'https://prim.iledefrance-mobilites.fr/marketplace';
const TIMEOUT_MS = 60_000;

export class PrimError extends Error {
  constructor(public readonly status: number) {
    super(`PRIM HTTP ${status}`);
    this.name = 'PrimError';
  }
}

async function primGet(pathAndQuery: string, apiKey: string): Promise<unknown> {
  const res = await fetch(`${BASE}${pathAndQuery}`, {
    headers: { apikey: apiKey, Accept: 'application/json', 'Accept-Encoding': 'gzip' },
    cache: 'no-store',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new PrimError(res.status);
  return res.json();
}

export function fetchEstimatedTimetable(apiKey: string): Promise<unknown> {
  return primGet('/estimated-timetable?LineRef=ALL', apiKey);
}

export function fetchDisruptions(apiKey: string): Promise<unknown> {
  return primGet('/disruptions_bulk/disruptions/v2', apiKey);
}
