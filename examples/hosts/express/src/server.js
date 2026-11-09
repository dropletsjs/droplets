/**
 * Pattern 1: Express as a host. The droplets server runs elsewhere; Express
 * fetches fragments and renders them into its own pages.
 */
import express from "express";
import { createDropletClient, layout } from "./droplets.js";
import { shop } from "./shop.js";

const PORT = Number(process.env.PORT ?? 8003);
const droplets = createDropletClient({
  internalUrl: process.env.DROPLETS_INTERNAL_URL ?? "http://localhost:8000",
  publicUrl: process.env.DROPLETS_PUBLIC_URL ?? "http://localhost:8000",
});

// The Svelte example's droplets (examples/frameworks/svelte), one per mode.
const IDS = ["client", "ssr-hydrate", "ssr-nohydrate"];

const app = express();

// The shop demo: /gallery, /product/:slug, /login, /admin, and its proxy.
app.use(
  shop({
    internalUrl: process.env.SHOP_INTERNAL_URL ?? "http://localhost:8300",
    publicUrl: process.env.SHOP_PUBLIC_URL ?? `http://localhost:${PORT}`,
  }),
);

app.get("/", async (req, res) => {
  const who = typeof req.query.who === "string" ? req.query.who : "Express";
  const fragments = await Promise.all(
    IDS.map((id) => droplets.fragment(id, { who })),
  );

  res.type("html").send(
    layout({
      title: "Express page, three Svelte droplets",
      intro: 'Fragments fetched by Express and rendered on the server. Try <a href="/?who=Node">?who=Node</a>, or the <a href="/gallery">shop demo</a>.',
      body: fragments.join(""),
      clientScript: droplets.clientScript,
    }),
  );
});

app.listen(PORT, () => {
  console.log(`express host listening on http://localhost:${PORT}`);
});
