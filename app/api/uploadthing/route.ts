import { createRouteHandler } from 'uploadthing/next';
import { marketplaceFileRouter } from './core';

// UploadThing v7 App Router adapter. UPLOADTHING_TOKEN is read from the
// server runtime env — never exposed to the browser.
export const { GET, POST } = createRouteHandler({
  router: marketplaceFileRouter,
});
