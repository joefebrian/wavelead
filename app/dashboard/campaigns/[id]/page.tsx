import type { Metadata } from 'next';
import CampaignDetailClient from './CampaignDetailClient';

export const metadata: Metadata = { title: 'Campaign — WaveLead', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function BrandCampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CampaignDetailClient campaignId={id} />;
}
