import path from "path";
import type { NextConfig } from "next";

const staticExport = process.env.PVC_STATIC_EXPORT === "1";
const backendUrl = (process.env.PVC_BACKEND_URL || "http://127.0.0.1:8010").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(__dirname),
  },
  images: {
    unoptimized: true,
  },
  ...(staticExport
    ? {
        output: "export" as const,
        trailingSlash: true,
      }
    : {
        // Browser always calls same host:/api — works from LAN IPs (not only localhost).
        async rewrites() {
          return [
            { source: "/api/:path*", destination: `${backendUrl}/api/:path*` },
            { source: "/health", destination: `${backendUrl}/health` },
          ];
        },
      }),
};

export default nextConfig;
