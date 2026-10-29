import './globals.css';
import type { Metadata, Viewport } from 'next';
import { Providers } from './providers';
import { Toaster } from 'sonner';
import type { ReactNode } from 'react';
import ConsentBanner from '@/components/consent/ConsentBanner';
import AnalyticsAutoPageView from '@/components/consent/AnalyticsAutoPageView';
import GoogleAnalytics from '@/components/analytics/GoogleAnalytics';
import SupportWidget from '@/components/support/SupportWidget';
import PwaProvider from '@/components/pwa/PwaProvider';
import { JsonLd, organizationSchema, webSiteSchema } from '@/lib/seo/structuredData';

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
    // M18 — default OpenGraph branding uses the local logo asset (never a
    // temporary/signed external URL).
    images: [{ url: '/brand/wavelead-logo.png', width: 2172, height: 724, alt: 'WaveLead' }],
  },
  applicationName: 'WaveLead',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/favicon-16.png', sizes: '16x16', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: { capable: true, title: 'WaveLead', statusBarStyle: 'default' },
  formatDetection: { telephone: false },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#12B981',
};

// Captures the install prompt as early as possible (before React hydrates) so
// it is never lost; the PWA provider picks it up from window.__wlBip.
const PWA_EARLY_CAPTURE = "window.__wlBip=null;window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__wlBip=e;window.dispatchEvent(new Event('wl:bip'));});window.addEventListener('appinstalled',function(){window.__wlBip=null;window.__wlInstalled=true;window.dispatchEvent(new Event('wl:appinstalled'));});";

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
        <script dangerouslySetInnerHTML={{ __html: PWA_EARLY_CAPTURE }} />
      </head>
      <body className="min-h-screen bg-background text-foreground overflow-x-hidden pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
        {/* M17 — AEO/GEO entity graph. Server-rendered from our own data only. */}
        <JsonLd id="ld-organization" data={organizationSchema()} />
        <JsonLd id="ld-website" data={webSiteSchema()} />
        <Providers>
          <PwaProvider>
          {children}
          <ConsentBanner />
          <AnalyticsAutoPageView />
          {/* M17 — GA4, mounted but inert until analytics consent is granted. */}
          <GoogleAnalytics />
          {/* M19.2 — Support chat widget. Never renders inside /admin. */}
          <SupportWidget />
          <Toaster richColors position="top-right" />
          </PwaProvider>
        </Providers>
      </body>
    </html>
  );
}
