import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // The engine is the reference implementation — type errors fail the build.
  typescript: {
    ignoreBuildErrors: false,
  },
  reactStrictMode: true,
};

export default nextConfig;
