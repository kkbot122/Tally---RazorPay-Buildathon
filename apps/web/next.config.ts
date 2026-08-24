import type { NextConfig } from "next";

const nextConfig: NextConfig = {};

const apiOrigin = process.env.TALLY_API_ORIGIN
  ?? (process.env.NODE_ENV === "development" ? "http://127.0.0.1:3001" : undefined);

const nextConfigWithApiProxy: NextConfig = {
  ...nextConfig,
  async rewrites() {
    return apiOrigin === undefined ? [] : [{ source: "/api/:path*", destination: `${apiOrigin}/api/:path*` }];
  },
};

export default nextConfigWithApiProxy;
