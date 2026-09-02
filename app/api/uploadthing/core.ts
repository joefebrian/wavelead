// Phase B3.2 Gate B — UploadThing v7 file router for marketplace delivery
// screenshots. Direct browser-to-provider upload; WaveLead stores only the
// signed metadata returned by the router in onUploadComplete.
//
// Server enforcement:
//   • Authenticated marketplace-order OWNER only
//   • Only image/jpeg, image/png, image/webp
//   • Max 5 files, max 5 MB each
//   • Never trust client-supplied `key` / `url` / MIME — every response value
//     used by the app comes from `onUploadComplete({ file })` (provider-signed).
import { createUploadthing, type FileRouter } from 'uploadthing/next';
import { UploadThingError } from 'uploadthing/server';
import { z } from 'zod';
import { resolveActor } from '@/lib/auth/rbac';
import { marketplaceOrderRepo } from '@/lib/repositories/marketplaceRepo';
import { channelRepo } from '@/lib/repositories/channelRepo';
import { hasAtLeastRole, ROLES } from '@/lib/auth/rbac';

const f = createUploadthing();

function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'delivery-image';
  const cleaned = base
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 180);
  return cleaned || 'delivery-image';
}

export const marketplaceFileRouter = {
  // Route name must match the client hook: useUploadThing('deliveryScreenshots').
  deliveryScreenshots: f(
    {
      // Exact MIME allowlist — no `image` shorthand, no SVG/GIF/PDF/video.
      // UploadThing v7 sizes are power-of-2; we use 4MB at the provider
      // (nearest ≤ our 5MB spec) and re-check size_bytes ≤ 5MB server-side.
      'image/jpeg': { maxFileSize: '4MB', maxFileCount: 5 },
      'image/png': { maxFileSize: '4MB', maxFileCount: 5 },
      'image/webp': { maxFileSize: '4MB', maxFileCount: 5 },
    },
    { awaitServerData: true },
  )
    .input(z.object({ orderId: z.string().uuid() }))
    .middleware(async ({ req, input, files }) => {
      // Authenticate the actor from the request cookies (same session cookie
      // the rest of the app uses). Reject anonymous uploads.
      const actor = await resolveActor(req as unknown as import('next/server').NextRequest);
      if (!actor) throw new UploadThingError('Unauthorized');

      // Ownership check — the uploader must be the marketplace-order owner.
      const order = await marketplaceOrderRepo.findById(input.orderId);
      if (!order) throw new UploadThingError('Order not found');
      if (order.owner_user_id !== actor.user.id) {
        throw new UploadThingError('Only the channel owner may upload delivery evidence for this order');
      }

      // Defensive checks — the file router already declares these but we
      // re-verify server-side in case the SDK config changes.
      if (!Array.isArray(files) || files.length < 1 || files.length > 5) {
        throw new UploadThingError('Submit between 1 and 5 images');
      }
      const allowed = new Set(['image/jpeg', 'image/png', 'image/webp']);
      const MAX_BYTES = 5 * 1024 * 1024;
      for (const file of files) {
        if (!allowed.has(file.type)) throw new UploadThingError('Only JPEG, PNG, or WebP images allowed');
        if (file.size > MAX_BYTES) throw new UploadThingError('Each image must be ≤ 5 MB');
      }

      // These become `metadata` in onUploadComplete — trusted server-side identity.
      return { ownerId: actor.user.id, orderId: input.orderId };
    })
    .onUploadComplete(async ({ metadata, file }) => {
      // v7 returns file.ufsUrl (canonical *.ufs.sh CDN URL) + file.key.
      // Every field returned here is provider-signed and travels back to the
      // client as `result.serverData`. Never trust client-echoed values.
      return {
        provider: 'uploadthing' as const,
        storage_key: file.key,
        url: file.ufsUrl,
        mime_type: file.type,
        file_name_safe: safeFileName(file.name),
        size_bytes: file.size,
        uploaded_at: new Date().toISOString(),
        order_id: metadata.orderId,
        uploader_user_id: metadata.ownerId,
      };
    }),
  // M11-Batch2A \u2014 Owner-submitted FOLLOWER EVIDENCE screenshots.
  // Single image per submission. Same MIME allowlist as delivery evidence.
  channelFollowerEvidence: f(
    {
      'image/jpeg': { maxFileSize: '4MB', maxFileCount: 1 },
      'image/png': { maxFileSize: '4MB', maxFileCount: 1 },
      'image/webp': { maxFileSize: '4MB', maxFileCount: 1 },
    },
    { awaitServerData: true },
  )
    .input(z.object({ channelId: z.string().uuid() }))
    .middleware(async ({ req, input, files }) => {
      const actor = await resolveActor(req as unknown as import('next/server').NextRequest);
      if (!actor) throw new UploadThingError('Unauthorized');
      const channel = await channelRepo.findById(input.channelId);
      if (!channel) throw new UploadThingError('Channel not found');
      const isOwner = channel.owner_id && channel.owner_id === actor.user.id;
      const isMod = hasAtLeastRole(actor.user, ROLES.MODERATOR);
      if (!isOwner && !isMod) throw new UploadThingError('Only the verified channel owner may upload follower evidence');
      if (!Array.isArray(files) || files.length !== 1) throw new UploadThingError('Submit exactly one screenshot');
      const allowed = new Set(['image/jpeg', 'image/png', 'image/webp']);
      const MAX_BYTES = 5 * 1024 * 1024;
      for (const file of files) {
        if (!allowed.has(file.type)) throw new UploadThingError('Only JPEG, PNG, or WebP images allowed');
        if (file.size > MAX_BYTES) throw new UploadThingError('Image must be \u2264 5 MB');
      }
      return { ownerId: actor.user.id, channelId: input.channelId };
    })
    .onUploadComplete(async ({ metadata, file }) => {
      return {
        provider: 'uploadthing' as const,
        storage_key: file.key,
        url: file.ufsUrl,
        mime_type: file.type,
        file_name_safe: safeFileName(file.name),
        size_bytes: file.size,
        uploaded_at: new Date().toISOString(),
        channel_id: metadata.channelId,
        uploader_user_id: metadata.ownerId,
      };
    }),
} satisfies FileRouter;

export type MarketplaceFileRouter = typeof marketplaceFileRouter;
