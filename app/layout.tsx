import './globals.css';
import type { Metadata } from 'next';
import { Providers } from './providers';
import { Toaster } from 'sonner';
import type { ReactNode } from 'react';
import ConsentBanner from '@/components/consent/ConsentBanner';
import AnalyticsAutoPageView from '@/components/consent/AnalyticsAutoPageView';

export const metadata: Metadata = {
  title: {
    default: 'WaveLead — The Growth Infrastructure for WhatsApp Channels',
    template: '%s · WaveLead',
  },
  description:
    'Discover, follow and grow public WhatsApp Channels. WaveLead is an independent directory and growth platform for channel creators worldwide.',
  metadataBase: new URL(process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'),
  openGraph: {
    title: 'WaveLead — The Growth Infrastructure for WhatsApp Channels',
    description: 'Discover, follow and grow public WhatsApp Channels. Independent platform.',
    type: 'website',
    siteName: 'WaveLead',
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-background text-foreground overflow-x-hidden">
        <Providers>
          {children}
          <ConsentBanner />
          <AnalyticsAutoPageView />
          <Toaster richColors position="top-right" />
        </Providers>
      </body>
    </html>
  );
}
