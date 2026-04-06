import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  // Static export for production — served by Express alongside the existing app
  ...(isProd && {
    output: "export",
    distDir: "out",
  }),

  // Proxy API calls to Express backend during development only
  ...(!isProd && {
    async rewrites() {
      return [
        {
          source: "/api/:path*",
          destination: "http://localhost:3000/api/:path*",
        },
      ];
    },
  }),

  // Static export doesn't support next/image optimization — use unoptimized
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
