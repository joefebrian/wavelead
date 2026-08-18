/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',

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
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'ALLOWALL' },
          { key: 'Content-Security-Policy', value: 'frame-ancestors *;' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
