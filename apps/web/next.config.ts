import type { NextConfig } from "next";

const nextConfig: NextConfig = {};

const apiOrigin = process.env.TALLY_API_ORIGIN ?? "http://127.0.0.1:3001";

const nextConfigWithApiProxy: NextConfig = {
  ...nextConfig,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiOrigin}/api/:path*` }];
  },
};

export default nextConfigWithApiProxy;
