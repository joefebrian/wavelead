import type { Metadata } from 'next';
import OpportunitiesClient from './OpportunitiesClient';

export const metadata: Metadata = { title: 'Campaign Opportunities — WaveLead', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default function OpportunitiesPage() {
  return <OpportunitiesClient />;
}
