/**
 * Pattern 2: one process. The built droplets server (`dist/server.js`) exports
 * a `fetch` handler, so Express can mount it under the same origin and serve
 * its own pages next to it. No second server, no CORS, no x-host.
 *
 * Run from this folder after building examples/frameworks/svelte:
 *   DROPLETS_DIST=../../frameworks/svelte/dist node src/embedded.js
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import express from "express";
import { getRequestListener } from "@hono/node-server";
import { layout } from "./droplets.js";

const PORT = Number(process.env.PORT ?? 8003);
const distDir = resolve(process.env.DROPLETS_DIST ?? "../../frameworks/svelte/dist");

// The droplets server as a module: `{ fetch(request) }`, nothing listening.
const droplets = (await import(pathToFileURL(resolve(distDir, "server.js")).href)).default;

// The Svelte example's droplets (examples/frameworks/svelte), one per mode.
const IDS = ["client", "ssr-hydrate", "ssr-nohydrate"];

const app = express();

// Express renders its page by calling the handler in-process: no HTTP hop.
app.get("/", async (req, res) => {
  const who = typeof req.query.who === "string" ? req.query.who : "Express";
  const origin = `${req.protocol}://${req.get("host")}`;
  const fragment = async (id, props = {}) => {
    const url = new URL(`/droplets/${id}`, origin);
    for (const [key, value] of Object.entries(props)) url.searchParams.set(key, value);
    return (await droplets.fetch(new Request(url))).text();
  };

  res.type("html").send(
    layout({
      title: "Express and droplets, one process",
      intro: "The droplets server is mounted inside this Express app; its routes live under this origin.",
      body: (await Promise.all(IDS.map((id) => fragment(id, { who })))).join(""),
      clientScript: '<script type="module" src="/index.js"></script>',
    }),
  );
});

// Everything else is a droplets route: /droplets/*, /droplets/<id>/client.js, /assets/*, /api/* ...
app.use(getRequestListener(droplets.fetch));

app.listen(PORT, () => {
  console.log(`express + droplets listening on http://localhost:${PORT}`);
});
