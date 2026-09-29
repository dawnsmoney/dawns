import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // the share-card renderer reads its fonts from disk at run time
  outputFileTracingIncludes: { "/api/admin/cards/[id]": ["./src/fonts/og/**"], "/api/admin/cards": ["./src/fonts/og/**"], "/api/share/plan/[id]": ["./src/fonts/og/**"] },
};

export default nextConfig;
