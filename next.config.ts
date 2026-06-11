import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // vídeos de produto vão até 20MB; FormData adiciona overhead
      bodySizeLimit: '25mb',
    },
  },
};

export default nextConfig;
