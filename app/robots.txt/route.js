import { NextResponse } from 'next/server';

export function GET() {
  const base = process.env.NEXT_PUBLIC_BASE_URL || '';
  const body = `User-agent: *
Allow: /
Disallow: /dashboard
Disallow: /admin
Disallow: /api
Sitemap: ${base}/sitemap.xml
`;
  return new NextResponse(body, { headers: { 'Content-Type': 'text/plain' } });
}
