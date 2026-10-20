import type { Metadata } from 'next';
import Link from 'next/link';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { Button } from '@/components/ui/button';
import { channelService } from '@/lib/services/channelService';
import { notFound } from 'next/navigation';
import { OWNERSHIP_SUPPORT_EMAIL } from '@/lib/services/ownershipState';

export const metadata: Metadata = {
  title: 'Report ownership issue — WaveLead',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

interface Params { slug: string; }

export default async function ReportChannelPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const channel = await channelService.getPublicBySlug(slug);
  if (!channel) notFound();
  return (
    <>
      <Header />
      <main className="container py-10 max-w-2xl">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Report an issue</div>
        <h1 className="text-2xl md:text-3xl font-bold">Ownership concern about {channel.name}</h1>
        <p className="mt-2 text-muted-foreground">If you run this channel and believe its ownership record on WaveLead is incorrect, contact our support team. Your message is reviewed manually by WaveLead staff; ownership is never transferred automatically.</p>
        <div className="mt-6 wh-card p-6">
          <p className="text-sm text-muted-foreground">Email <a href={`mailto:${OWNERSHIP_SUPPORT_EMAIL}?subject=${encodeURIComponent(`Ownership review: ${channel.name}`)}`} className="underline" data-testid="ownership-support-email">{OWNERSHIP_SUPPORT_EMAIL}</a> with:</p>
          <ul className="mt-2 text-sm list-disc pl-5 space-y-1">
            <li>Channel: <Link href={`/channel/${channel.slug}`} className="underline">{channel.name}</Link></li>
            <li>Why you believe the ownership is incorrect</li>
            <li>Any evidence links (official website, socials, etc.)</li>
          </ul>
          <div className="mt-5 flex gap-2">
            <Link href={`/channel/${channel.slug}`}><Button variant="outline">Back to channel</Button></Link>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
