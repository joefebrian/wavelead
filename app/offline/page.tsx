import type { Metadata } from 'next';

// Branded offline fallback served by the service worker when a page cannot be
// loaded. Fully self-contained (inline styles, no data fetching, no JS
// dependency) so it renders even when no CSS/JS bundle is cached.
export const metadata: Metadata = {
  title: 'Offline',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-static';

const wrap: React.CSSProperties = {
  minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 'max(24px, env(safe-area-inset-top)) 24px max(24px, env(safe-area-inset-bottom))',
  background: '#F9FAFC', color: '#10233F',
  fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
};
const card: React.CSSProperties = {
  width: '100%', maxWidth: 380, textAlign: 'center', background: '#fff',
  border: '1px solid #E4E9F0', borderRadius: 16, padding: '32px 24px',
  boxShadow: '0 1px 2px rgba(16,35,63,.04), 0 8px 24px rgba(16,35,63,.06)',
};
const btn: React.CSSProperties = {
  display: 'inline-block', marginTop: 20, padding: '12px 22px', borderRadius: 10,
  background: '#12B981', color: '#fff', fontWeight: 600, fontSize: 15, textDecoration: 'none',
};

export default function OfflinePage() {
  return (
    <main style={wrap} data-testid="offline-page">
      <div style={card}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon-192.png" alt="WaveLead" width={64} height={64} style={{ borderRadius: 14, margin: '0 auto' }} />
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: '18px 0 6px' }}>You&rsquo;re offline</h1>
        <p style={{ fontSize: 14, lineHeight: 1.55, color: '#5B6B82', margin: 0 }}>
          WaveLead needs an internet connection to load channels, dashboards and payments.
          We&rsquo;ll reconnect automatically when you&rsquo;re back online.
        </p>
        <a href="" style={btn} data-testid="offline-retry">Try again</a>
      </div>
      <script
        dangerouslySetInnerHTML={{
          __html: "window.addEventListener('online',function(){location.reload()});",
        }}
      />
    </main>
  );
}
