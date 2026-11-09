import node from "@astrojs/node";
import { defineConfig } from "astro/config";

// Pages are rendered per request, so each one can fetch fresh fragments.
export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  server: { port: 8005 },
  security: {
    // Astro's check compares a form post's Origin with the request's URL,
    // whose host it trusts only when `allowedDomains` (fixed at build) lists
    // it. src/middleware.ts runs the same check against SHOP_PUBLIC_URL, read
    // at runtime, so the image does not need its origin at build.
    checkOrigin: false,
  },
});
