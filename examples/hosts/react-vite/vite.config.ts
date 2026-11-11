import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type ProxyOptions } from "vite";

/**
 * Request headers that would name another host to the shop: never passed on.
 * The shop reads them only as a fallback for its location, and trusts them
 * only against its allow-list.
 */
const HOST_HEADERS = ["forwarded", "x-forwarded-host", "x-forwarded-proto", "x-forwarded-prefix", "x-forwarded-for"];

type ProxyEvents = {
  on(event: "proxyReq", listener: (request: { removeHeader(name: string): void }) => void): void;
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "SHOP_");
  // How this server reaches the shop, and this app's public origin, sent as
  // `x-droplet-location` (written out, never the client's Host).
  const target = env["SHOP_INTERNAL_URL"] ?? "http://localhost:8300";
  const publicUrl = env["SHOP_PUBLIC_URL"] ?? "http://localhost:8004";

  // The shop demo, same-origin: what the browser asks the shop for goes
  // through this server, so its cookies are this origin's own.
  const shop: ProxyOptions = {
    target,
    headers: { "x-droplet-location": publicUrl },
    configure: (proxy) => {
      // The proxy is a Node EventEmitter; typed here without pulling in @types/node.
      const emitter = proxy as unknown as ProxyEvents;
      emitter.on("proxyReq", (request) => {
        for (const name of HOST_HEADERS) request.removeHeader(name);
      });
    },
  };
  const proxy = { "^/index\\.js$": shop, "/droplets/": shop, "/assets/": shop, "/api/": shop };

  return {
    plugins: [react()],
    // `/assets/*` is the shop's (proxied); this app's own files go elsewhere.
    build: { assetsDir: "app" },
    server: { port: 8004, strictPort: true, proxy },
    preview: { port: 8004, strictPort: true, proxy },
  };
});
