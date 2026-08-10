import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // The repo lives on an exFAT external drive where Turbopack's persistent
    // dev cache gets corrupted ("Failed to open database" on startup).
    turbopackFileSystemCacheForDev: false,
  },
  turbopack: {
    resolveAlias: {
      // Optional dep of @wagmi/core's Tempo connector (unused).
      // Turbopack errors on the unresolved dynamic import without this stub.
      accounts: "./stubs/empty.ts",
    },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains",
          },
          {
            // Directives that can't break the app (no script-src/connect-src:
            // Next inline hydration scripts + WalletConnect/RPC endpoints make
            // a full lockdown brittle — tighten with nonces if ever needed).
            key: "Content-Security-Policy",
            value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
