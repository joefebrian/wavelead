import type { MetadataRoute } from 'next';

// WaveLead Web App Manifest → served at /manifest.webmanifest
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'WaveLead',
    short_name: 'WaveLead',
    description: 'Growth & Monetization Platform for WhatsApp Channels',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    display_override: ['standalone', 'minimal-ui'],
    background_color: '#F9FAFC',
    theme_color: '#12B981',
    lang: 'en',
    dir: 'ltr',
    categories: ['business', 'productivity', 'social'],
    prefer_related_applications: false,
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Discover Channels', url: '/channels', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'Dashboard', url: '/dashboard', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
    ],
  };
}
