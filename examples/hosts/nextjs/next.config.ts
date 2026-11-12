import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Copies only what the server needs into .next/standalone, for the Dockerfile.
  output: "standalone",
  // This folder is the app root even when it sits inside a larger repository;
  // without this, Next nests the standalone output under the repo's path.
  outputFileTracingRoot: import.meta.dirname,
  // The shop pages carry a visitor's cart and session: never cached, as on
  // every other host. A server component cannot set this itself.
  headers: async () => [
    {
      source: "/(gallery|admin|login)",
      headers: [{ key: "cache-control", value: "private, no-store" }],
    },
    {
      source: "/product/:slug",
      headers: [{ key: "cache-control", value: "private, no-store" }],
    },
  ],
};

export default nextConfig;
