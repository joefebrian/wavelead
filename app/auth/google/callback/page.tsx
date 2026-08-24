'use client';

// Emergent Google callback landing page.
//
// The Emergent flow appends the one-time session id to the callback URL as a
// URL fragment (#session_id=...) that never reaches the server. This client
// component extracts it, immediately strips it from window.history, and POSTs
// it to /api/auth/google/exchange for the server-side identity redemption and
// wl_session cookie mint.
//
// The session id is treated as a one-time credential:
//   * Removed from the URL before any React renders complete
//   * Never persisted to localStorage / sessionStorage
//   * Never logged
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function CallbackPage() {
  return (
    <Suspense fallback={<Fallback message="Signing you in…" />}>
      <CallbackInner />
    </Suspense>
  );
}

function CallbackInner() {
  const router = useRouter();
  const search = useSearchParams();
  const [msg, setMsg] = useState('Signing you in…');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // 1. Extract session id from fragment first, then query string as fallback.
      const fragmentRaw = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash;
      const fragment = new URLSearchParams(fragmentRaw);
      const sessionId = fragment.get('session_id') || search.get('session_id') || '';
      // 2. Strip credential from URL immediately (before rendering / logging anywhere).
      if (window.location.hash || search.get('session_id')) {
        window.history.replaceState({}, document.title, window.location.pathname);
      }
      if (!sessionId) {
        setError('No session id was returned from Google. Please try again.');
        return;
      }
      if (sessionId.length > 1024) {
        setError('Invalid Google session response.');
        return;
      }
      // 3. Exchange on our server. Cookie set on success.
      let res: Response;
      try {
        res = await fetch('/api/auth/google/exchange', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ session_id: sessionId }),
          cache: 'no-store',
        });
      } catch {
        setError('Network error contacting sign-in service.');
        return;
      }
      if (cancelled) return;
      if (res.status === 401) { setError('This Google sign-in link has expired. Please click "Continue with Google" again.'); return; }
      if (res.status === 403) { setError('This account is not eligible to sign in with Google.'); return; }
      if (!res.ok) { setError('Google sign-in failed. Please try again.'); return; }
      setMsg('Signed in — redirecting…');
      router.replace('/dashboard');
      router.refresh();
    })().catch(() => setError('Unexpected error during sign-in.'));
    return () => { cancelled = true; };
  }, [router, search]);

  if (error) return <Fallback message={error} isError />;
  return <Fallback message={msg} />;
}

function Fallback({ message, isError = false }: { message: string; isError?: boolean }) {
  return (
    <main className="container py-24 flex flex-col items-center gap-6 text-center">
      <div className={`h-12 w-12 rounded-full ${isError ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary'} flex items-center justify-center`}>
        {isError ? '!' : (
          <svg className="animate-spin h-6 w-6" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
            <path fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
          </svg>
        )}
      </div>
      <p className={`text-sm ${isError ? 'text-destructive' : 'text-muted-foreground'}`}>{message}</p>
      {isError && (
        <a href="/login" className="text-sm text-primary hover:underline">Return to login</a>
      )}
    </main>
  );
}
