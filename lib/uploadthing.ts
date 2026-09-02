// Phase B3.2 Gate B — Typed client helpers for delivery screenshot uploads.
import { generateReactHelpers } from '@uploadthing/react';
import type { MarketplaceFileRouter } from '@/app/api/uploadthing/core';

export const { useUploadThing, uploadFiles } = generateReactHelpers<MarketplaceFileRouter>();
