import type { Metadata } from 'next';
import CampaignsClient from './CampaignsClient';

// M18 — Brand workspace: Brand Launch Campaigns. Private surface.
export const metadata: Metadata = { title: 'Campaigns — WaveLead', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default function BrandCampaignsPage() {
  return <CampaignsClient />;
}
