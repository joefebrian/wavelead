// Generates WaveLead PWA / favicon assets from the OFFICIAL product logo
// (public/brand/wavelead-logo.png). The "W" mark is cropped from the left of
// the wordmark, trimmed, and composed onto square canvases.
//   node scripts/generate_pwa_icons.mjs
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

const SRC = 'public/brand/wavelead-logo.png';
const OUT = 'public/icons';
mkdirSync(OUT, { recursive: true });

const meta = await sharp(SRC).metadata();
// The mark occupies roughly the left third of the 3:1 wordmark.
const markRaw = await sharp(SRC)
  .extract({ left: 0, top: 0, width: Math.round(meta.width * 0.34), height: meta.height })
  .png().toBuffer();
const mark = await sharp(markRaw).trim({ threshold: 1 }).png().toBuffer();
const markMeta = await sharp(mark).metadata();
console.log('mark', markMeta.width, 'x', markMeta.height);

const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

async function square(size, markScale, file, bg = WHITE) {
  const target = Math.round(size * markScale);
  const resized = await sharp(mark).resize({ width: target, height: target, fit: 'inside' }).png().toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: bg } })
    .composite([{ input: resized, gravity: 'center' }])
    .png({ compressionLevel: 9 })
    .toFile(`${OUT}/${file}`);
  console.log('wrote', file);
}

// "any" purpose icons — white tile, mark at 76% width.
await square(192, 0.76, 'icon-192.png');
await square(512, 0.76, 'icon-512.png');
// Maskable — mark kept inside the 80% safe zone (≈ 58% of the canvas).
await square(512, 0.58, 'icon-maskable-512.png');
await square(192, 0.58, 'icon-maskable-192.png');
// Apple touch icon — iOS ignores transparency and applies its own mask.
await square(180, 0.70, 'apple-touch-icon.png');
// Favicons — transparent background reads better in browser tabs.
await square(32, 0.94, 'favicon-32.png', { r: 0, g: 0, b: 0, alpha: 0 });
await square(16, 0.98, 'favicon-16.png', { r: 0, g: 0, b: 0, alpha: 0 });
