import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    const aasaHeaders = [
      { key: "Content-Type", value: "application/json" },
      { key: "Cache-Control", value: "public, max-age=3600" },
    ];

    return [
      {
        source: "/.well-known/apple-app-site-association",
        headers: aasaHeaders,
      },
      {
        source: "/apple-app-site-association",
        headers: aasaHeaders,
      },
    ];
  },
};

export default nextConfig;
