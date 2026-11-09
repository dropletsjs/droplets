import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Copies only what the server needs into .next/standalone, for the Dockerfile.
  output: "standalone",
  // This folder is the app root even when it sits inside a larger repository;
  // without this, Next nests the standalone output under the repo's path.
  outputFileTracingRoot: import.meta.dirname,
};

export default nextConfig;
