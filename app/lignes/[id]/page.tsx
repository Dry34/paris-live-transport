import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getNetwork } from '@/lib/realtime/poller';
import { resolveLineId } from '@/lib/lineSlug';
import { LinePageClient } from '@/components/LinePageClient';
import { lineName } from '@/components/LineBadge';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const network = getNetwork();
  const lineId = resolveLineId(network, decodeURIComponent(id));
  return { title: lineId ? `${lineName(network.lines[lineId])}, rames en direct` : 'Ligne introuvable' };
}

export default async function LinePage({ params }: Props) {
  const { id } = await params;
  const lineId = resolveLineId(getNetwork(), decodeURIComponent(id));
  if (!lineId) notFound();
  return <LinePageClient lineId={lineId} />;
}
