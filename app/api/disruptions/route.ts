import { NextResponse } from 'next/server';
import { liveCacheControl } from '@/lib/realtime/httpCache';
import { getPoller } from '@/lib/realtime/poller';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const poller = getPoller();
  poller.start();
  await poller.refresh().catch(() => undefined);
  const line = new URL(req.url).searchParams.get('line');
  const list = poller.disruptions().filter((d) => !line || d.lineIds.includes(line));
  return NextResponse.json(list, { headers: { 'Cache-Control': liveCacheControl() } });
}
