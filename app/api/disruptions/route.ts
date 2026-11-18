import { NextResponse } from 'next/server';
import { getPoller } from '@/lib/realtime/poller';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(req: Request) {
  const poller = getPoller();
  poller.start();
  const line = new URL(req.url).searchParams.get('line');
  const list = poller.disruptions().filter((d) => !line || d.lineIds.includes(line));
  return NextResponse.json(list, { headers: { 'Cache-Control': 'no-store' } });
}
