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
};

export default nextConfig;
