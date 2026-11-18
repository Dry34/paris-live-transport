import { NextResponse } from 'next/server';
import { liveCacheControl } from '@/lib/realtime/httpCache';
import { getPoller } from '@/lib/realtime/poller';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const poller = getPoller();
  poller.start();
  await poller.refresh().catch(() => undefined); // a failed call keeps the last snapshot
  const snap = poller.snapshot();
  if (!snap) {
    return NextResponse.json({ error: 'Aucune donnée temps réel disponible pour le moment' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  return NextResponse.json(
    { fetchedAt: snap.fetchedAt, source: snap.source, runs: snap.runs },
    { headers: { 'Cache-Control': liveCacheControl() } },
  );
}
