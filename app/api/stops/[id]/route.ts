import { NextResponse } from 'next/server';
import { departuresForStation } from '@/lib/realtime/departures';
import { getNetwork, getPoller } from '@/lib/realtime/poller';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const stationId = decodeURIComponent(id);
  const station = getNetwork().stations[stationId];
  if (!station) {
    return NextResponse.json({ error: 'Station inconnue' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }
  const poller = getPoller();
  poller.start();
  const snap = poller.snapshot();
  const departures = snap ? departuresForStation(snap, getNetwork(), stationId, Date.now()) : {};
  return NextResponse.json({ stationId, name: station.name, departures }, { headers: { 'Cache-Control': 'no-store' } });
}
