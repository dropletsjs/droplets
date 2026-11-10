import { readdirSync } from "node:fs";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import { baseLinks } from "./src/plugins/base-links.mjs";

// Where the site is served: https://dropletsjs.dev by default. Both come
// from the environment, so the same pages also build for another origin or
// a sub-path (apps/docs/README.md).
const site = process.env.DOCS_SITE || "https://dropletsjs.dev";
const base = process.env.DOCS_BASE || "/";

// The scripts of the docs' own components (src/components/*.astro) are
// always bundled to a file under /_astro/, never inlined into the page as
// Astro does with small ones: the CSP's script-src then needs a hash only
// for Starlight's inline scripts, and editing a component never changes it.
const ownScripts = readdirSync(new URL("./src/components/", import.meta.url))
  .filter((file) => file.endsWith(".astro"))
  .map((file) => `_astro/${file}_astro_type_script_`);
const assetsInlineLimit = (file) => (ownScripts.some((prefix) => file.startsWith(prefix)) ? false : undefined);

export default defineConfig({
  site,
  base,
  trailingSlash: "always",
  vite: {
    build: { assetsInlineLimit },
    // AddRenderer runs djs add's config edit, which parses with vite's
    // parseAst: vite stays a package at prerender time, not bundled into it.
    ssr: { external: ["vite"] },
  },
  integrations: [
    baseLinks(),
    starlight({
      title: "Droplets",
      description:
        "Server-rendered components you can embed from any stack, as a Vite plugin on Hono. Svelte, Vue, Solid, React, Preact, Hono JSX, Handlebars or Lit.",
      customCss: [
        "@fontsource-variable/inter/wght.css",
        "@fontsource-variable/instrument-sans/wght.css",
        "@fontsource-variable/jetbrains-mono/wght.css",
        "./src/styles/custom.css",
      ],
      // In reading order: the pages' "Next" links follow it.
      sidebar: [
        {
          label: "Start here",
          items: ["start/what-is-a-droplet", "start/getting-started", "start/manual-setup"],
        },
        {
          label: "Renderers",
          items: [
            { label: "Overview", slug: "renderers" },
            "renderers/svelte",
            "renderers/vue",
            "renderers/react",
            "renderers/preact",
            "renderers/solid",
            "renderers/hono-jsx",
            "renderers/handlebars",
            "renderers/lit",
            "renderers/script",
          ],
        },
        {
          label: "Integrating",
          items: [
            {
              label: "Known hosts",
              items: [
                "integrate/hosts/overview",
                "integrate/hosts/nginx",
                "integrate/hosts/express",
                "integrate/hosts/react",
                "integrate/hosts/astro",
                "integrate/hosts/sveltekit",
                "integrate/hosts/nextjs",
                "integrate/hosts/python",
                "integrate/hosts/ruby",
                "integrate/hosts/php",
                "integrate/hosts/htmx",
                "integrate/hosts/shop-demo",
              ],
            },
            "integrate/wordpress",
            "integrate/http-contract",
          ],
        },
        {
          label: "Writing droplets",
          items: [
            "guides/writing-droplets",
            "guides/errors",
            "guides/server",
            "guides/development",
            "guides/configuration",
          ],
        },
        { label: "In the browser", items: ["guides/in-the-browser"] },
        { label: "Deployment", items: ["guides/deployment"] },
        { label: "Security", items: ["guides/security"] },
        { label: "Reference", items: ["reference/api", "reference/contributing"] },
      ],
      lastUpdated: false,
      pagination: true,
    }),
  ],
});
