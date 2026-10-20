/** @type {import('next').NextConfig} */

// ---------------------------------------------------------------------------
// P0B — BUILD STAMPING.
// Deployment identity is captured HERE, at build time, and baked into the
// artifact. The running pod therefore reports the commit it was BUILT from,
// never whatever mutable workspace it happens to sit on (the previous runtime
// `git rev-parse` helper always reported "unknown" in production because no
// git tree ships with the image).
// Only non-secret identity values are stamped: commit, build time, release id.
// ---------------------------------------------------------------------------
const { execSync } = require('node:child_process');

function stampedCommit() {
  const fromEnv =
    process.env.BUILD_COMMIT ||
    process.env.GIT_COMMIT_SHA ||
    process.env.SOURCE_COMMIT ||
    process.env.GIT_COMMIT;
  if (fromEnv && String(fromEnv).trim()) return String(fromEnv).trim();
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
}

const BUILD_COMMIT = stampedCommit();
const BUILD_TIME = new Date().toISOString();
const RELEASE_ID = (process.env.RELEASE_ID || process.env.DEPLOYMENT_ID || '').trim();

const nextConfig = {
  // Baked at build time so `getBuildInfo()` describes the deployed artifact.
  env: {
    BUILD_COMMIT,
    BUILD_TIME,
    RELEASE_ID,
  },

  // NOTE: `output: 'standalone'` removed. It caused a build/dev artifact
  // collision that 404'd the dev-mode stylesheet on the deployed preview.
  // Re-enable this only for a dedicated production deploy pipeline that
  // never shares its `.next/` folder with `next dev`.

  // Next.js 15 requires this whitelist when the dev server is accessed
  // through the Emergent / Cloudflare preview hostnames.
  allowedDevOrigins: [
    'grow-infrastructure.preview.emergentagent.com',
    'grow-infrastructure.cluster-9.preview.emergentcf.cloud',
    '*.preview.emergentagent.com',
    '*.preview.emergentcf.cloud',
  ],

  images: {
    unoptimized: true,
    remotePatterns: [
      { protocol: 'https', hostname: 'avatars.githubusercontent.com', pathname: '/**' },
    ],
  },

  // Keep the MongoDB driver out of the client bundle / edge runtime.
  serverExternalPackages: ['mongodb'],

  // Reduce hot-reload churn (previous 512MB dev budget was overflowing).
  webpack(config, { dev }) {
    if (dev) {
      config.watchOptions = {
        poll: 3000,
        aggregateTimeout: 500,
        ignored: ['**/node_modules', '**/.next', '**/.git'],
      };
    }
    return config;
  },
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
  onDemandEntries: {
    maxInactiveAge: 30000,
    pagesBufferLength: 3,
  },

  // Global headers.
  // IMPORTANT: no CORS wildcard here. The API layer (app/api/[[...path]]/route.ts)
  // applies a strict per-origin allowlist. Duplicating it here would either
  // conflict with, or override, that policy.
  //
  // Security hardening (SEC-002):
  // - frame-ancestors 'none' + X-Frame-Options: DENY -> clickjacking protection
  // - HSTS (no includeSubDomains, no preload) -> encrypted transport w/o forcing
  //   unverified subdomains onto HTTPS
  // - X-Content-Type-Options: nosniff -> disables MIME sniffing
  // - Referrer-Policy: strict-origin-when-cross-origin -> minimum leakage
  // - Permissions-Policy: conservative denies that do NOT break required
  //   PayPal redirects, Google auth, GA4, support chat, or image loading.
  async headers() {
    const securityHeaders = [
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Content-Security-Policy', value: "frame-ancestors 'none';" },
      { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      {
        key: 'Permissions-Policy',
        value: [
          'camera=()',
          'microphone=()',
          'geolocation=()',
          'usb=()',
          'magnetometer=()',
          'gyroscope=()',
          'accelerometer=()',
          'payment=(self)',
          'browsing-topics=()',
          'interest-cohort=()',
        ].join(', '),
      },
    ];
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },
};

module.exports = nextConfig;
