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
    ],
  },
};

export default nextConfig;
