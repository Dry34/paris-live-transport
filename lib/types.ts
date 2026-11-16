export type Mode = 'metro' | 'rer' | 'tram' | 'transilien';
export type LngLat = [number, number];

export interface LineInfo { id: string; shortName: string; mode: Mode; color: string; textColor: string; longName: string }
export interface Quay { id: string; name: string; lon: number; lat: number; stationId: string }
export interface Station { id: string; name: string; lon: number; lat: number; quays: string[]; lines: string[] }
export interface Pattern { lineId: string; directionId: 0 | 1; quays: string[]; trips: number; headsign: string }
export interface Segment { coords: LngLat[]; seconds: number }           // clé "A>B" (quayIds)
export interface Network {
  generatedAt: string;
  lines: Record<string, LineInfo & { shapes: LngLat[][] }>;
  quays: Record<string, Quay>;
  stations: Record<string, Station>;
  patterns: Pattern[];
  segments: Record<string, Segment>;
}

export interface Journey {          // sortie du parsing SIRI
  ref: string; lineId: string; direction: string; destination: string; operator: 'RATP' | 'SNCF' | 'OTHER';
  calls: { quay: string; arr: number | null; dep: number | null }[];   // epoch ms
}
export interface RunStop { quay: string; arr: number | null; dep: number | null }
export interface VehicleRun {
  id: string; lineId: string; direction: string; destination: string;
  stops: RunStop[];                  // stops[0] = station précédente si connue
  hasPrevious: boolean; prevInferred: boolean;
}
export interface Snapshot { fetchedAt: number; source: 'live' | 'replay' | 'cache'; runs: VehicleRun[] }
export interface Departure { lineId: string; destination: string; direction: string; time: number; runId: string }
export interface Disruption { id: string; lineIds: string[]; title: string; message: string; severity: string; periods: { begin: number; end: number }[] }
