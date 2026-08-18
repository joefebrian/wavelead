import './globals.css';
import { Providers } from './providers';
import { Toaster } from 'sonner';

export const metadata = {
  title: {
    default: 'WaveHub — The Growth Infrastructure for WhatsApp Channels',
    template: '%s · WaveHub',
  },
  description:
    'Discover, follow and grow public WhatsApp Channels. WaveHub is an independent directory and growth platform for channel creators worldwide.',
  metadataBase: new URL(process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'),
  openGraph: {
    title: 'WaveHub — The Growth Infrastructure for WhatsApp Channels',
    description:
      'Discover, follow and grow public WhatsApp Channels. Independent platform.',
    type: 'website',
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }) {
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
      <body className="min-h-screen bg-background text-foreground">
        <Providers>
          {children}
          <Toaster richColors position="top-right" />
        </Providers>
      </body>
    </html>
  );
}
