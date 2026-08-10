import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["apache-arrow"],
  images: {
    // Remote patterns for customer logo sources (ordered fastest → slowest).
    // DuckDuckGo favicon: fast, no API key.
    // Google S2 favicon: medium, good quality.
    // Clearbit logo: slowest, highest quality.
    remotePatterns: [
      { protocol: "https", hostname: "icons.duckduckgo.com" },
      { protocol: "https", hostname: "www.google.com" },
      { protocol: "https", hostname: "logo.clearbit.com" },
      // Auth0 profile pictures (Google accounts served via lh3.googleusercontent.com)
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "s.gravatar.com" },
      { protocol: "https", hostname: "*.auth0.com" },
    ],
  },
  async redirects() {
    return [
      // /analytics folded into the Dashboard's Trends tab (Stage A IA merge,
      // docs/superpowers/specs/2026-08-07-app-design-foundation-design.md).
      // Temporary: the URL shape may change again once Stage B's Recharts
      // dark-palette work lands.
      { source: "/analytics", destination: "/dashboard?tab=trends", permanent: false },
    ];
  },
};

export default nextConfig;
