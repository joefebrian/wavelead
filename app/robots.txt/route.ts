import { NextResponse } from 'next/server';
export function GET(): NextResponse {
  const base = process.env.NEXT_PUBLIC_BASE_URL || '';
  // Auth surfaces and internal API/admin/dashboard are non-indexable.
  // Search results are noindex at the page level; disallow keeps them out of
  // crawl budget for polite crawlers as an additional signal.
  const body = `User-agent: *
Allow: /
Disallow: /dashboard
Disallow: /admin
Disallow: /api
Disallow: /login
Disallow: /signup
Disallow: /search
Sitemap: ${base}/sitemap.xml
`;
  return new NextResponse(body, { headers: { 'Content-Type': 'text/plain' } });
}
