// Stable, first-party channel avatar endpoint.
//
//   GET /api/channels/<slug>/avatar
//
// Serves WaveLead's own cached copy of a public channel's avatar. This exists
// because the WhatsApp CDN URLs captured during Submit Channel → Fetch
// Metadata are pre-signed and expire; hotlinking them produced broken images
// (and the previous blanket suppression produced letter placeholders even for
// avatars that were perfectly fine).
//
// Guarantees:
//   • Visibility — only channels that satisfy the canonical public-visibility
//     policy resolve here. A demo/fixture/pending/rejected channel 404s, so
//     this endpoint can never be used to confirm a hidden record exists.
//   • No open proxy — the URL is not an input. We only ever fetch the
//     channel's OWN stored logo_url (or the og:image re-read from its own
//     WhatsApp page), gated by a WhatsApp/Meta CDN host allowlist.
//   • Honest fallback — when no real avatar can be obtained we redirect to the
//     local placeholder SVG. We never synthesise an avatar.
//   • Read-only with respect to channel records. Writes touch only the
//     additive channel_avatar_cache collection.
import { NextRequest, NextResponse } from 'next/server';
import { channelRepo } from '@/lib/repositories/channelRepo';
import { isChannelPublicallyVisible } from '@/lib/services/publicChannelVisibility';
import { CHANNEL_FALLBACK_AVATAR } from '@/lib/seo/channelAvatar';
import { resolveCachedAvatar } from '@/lib/services/media/channelAvatarCache';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
): Promise<NextResponse | Response> {
  const { slug } = await params;

  const fallback = () =>
    NextResponse.redirect(new URL(CHANNEL_FALLBACK_AVATAR, request.nextUrl.origin), {
      status: 302,
      headers: { 'Cache-Control': 'public, max-age=300' },
    });

  try {
    const channel = await channelRepo.findBySlug(String(slug || ''));

    // Same visibility contract as every other public surface.
    if (!channel || channel.status !== 'approved' || !isChannelPublicallyVisible(channel)) {
      return new NextResponse('Not Found', { status: 404 });
    }
    if (!channel.logo_url) return fallback();

    const cached = await resolveCachedAvatar({
      id: channel.id,
      logo_url: channel.logo_url,
      whatsapp_url: channel.whatsapp_url,
    });
    if (!cached) return fallback();

    // Conditional request support — avatars rarely change.
    if (request.headers.get('if-none-match') === cached.etag) {
      return new NextResponse(null, {
        status: 304,
        headers: { ETag: cached.etag, 'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800' },
      });
    }

    const body = Buffer.isBuffer(cached.data) ? cached.data : Buffer.from(cached.data.buffer);
    return new Response(new Uint8Array(body), {
      status: 200,
      headers: {
        'Content-Type': cached.content_type,
        'Content-Length': String(body.byteLength),
        ETag: cached.etag,
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
        'X-Content-Type-Options': 'nosniff',
        'Cross-Origin-Resource-Policy': 'cross-origin',
      },
    });
  } catch {
    // Never surface a 500 for an <img>; degrade to the placeholder.
    return fallback();
  }
}
