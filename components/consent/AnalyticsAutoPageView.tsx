'use client';
// M11-Batch3 — Auto emit a page_view event on every client-side navigation.
// The server ultimately decides whether to persist based on consent state,
// so this is safe to mount globally.
import { useEffect, Suspense } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { trackEvent } from '@/lib/analytics/client';

function Inner() {
  const pathname = usePathname();
  const search = useSearchParams();
  useEffect(() => {
    trackEvent('page_view').catch(() => {});
  }, [pathname, search]);
  return null;
}

export default function AnalyticsAutoPageView() {
  return <Suspense fallback={null}><Inner /></Suspense>;
}
