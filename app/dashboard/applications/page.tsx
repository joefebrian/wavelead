import type { Metadata } from 'next';
import ApplicationsClient from './ApplicationsClient';

export const metadata: Metadata = { title: 'Campaign Applications — WaveLead', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default function ApplicationsPage() {
  return <ApplicationsClient />;
}
