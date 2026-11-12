import { readdirSync } from "node:fs";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import starlightLlmsTxt from "starlight-llms-txt";
import { description, ogImage, title } from "./site.mjs";
import { baseLinks } from "./src/plugins/base-links.mjs";
import { LLMS_PAGE_BREAK, llmsDetails, llmsTxt } from "./src/plugins/llms-txt.mjs";

// Where the site is served: https://dropletsjs.dev by default. Both come
// from the environment, so the same pages also build for another origin or
// a sub-path (apps/docs/README.md).
const site = process.env.DOCS_SITE || "https://dropletsjs.dev";
const base = process.env.DOCS_BASE || "/";

// Crawlers need the share image as an absolute URL, under the base path.
const ogImageUrl = new URL(`${base.replace(/\/?$/, "/")}${ogImage.file}`, site).href;
const meta = (key, content) => ({ tag: "meta", attrs: { [key.startsWith("og:") ? "property" : "name"]: key, content } });

// The scripts of the docs' own components (src/components/*.astro) are
// always bundled to a file under /_astro/, never inlined into the page as
// Astro does with small ones: the CSP's script-src then needs a hash only
// for Starlight's inline scripts, and editing a component never changes it.
const ownScripts = readdirSync(new URL("./src/components/", import.meta.url))
  .filter((file) => file.endsWith(".astro"))
  .map((file) => `_astro/${file}_astro_type_script_`);
const assetsInlineLimit = (file) => (ownScripts.some((prefix) => file.startsWith(prefix)) ? false : undefined);

// In reading order: the pages' "Next" links follow it, and so does llms-full.txt.
const sidebar = [
  {
    label: "Start here",
    items: ["start/what-is-a-droplet", "start/ways-to-use", "start/getting-started", "start/manual-setup"],
  },
  {
    label: "Writing droplets",
    items: [
      "guides/writing-droplets",
      "guides/styling",
      "guides/actions",
      "guides/prerendering",
      "guides/errors",
      "guides/server",
      "guides/development",
      "guides/configuration",
    ],
  },
  {
    label: "Renderers",
    collapsed: true,
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
      "integrate/any-stack",
      "integrate/client-only",
      "integrate/http-contract",
      {
        label: "Known hosts",
        collapsed: true,
        items: [
          { label: "Overview", slug: "integrate/hosts/overview" },
          "integrate/hosts/nginx",
          "integrate/hosts/express",
          "integrate/hosts/react-vite",
          "integrate/hosts/astro",
          "integrate/hosts/sveltekit",
          "integrate/hosts/nextjs",
          "integrate/hosts/fastapi",
          "integrate/hosts/sinatra",
          "integrate/hosts/php",
          "integrate/hosts/htmx",
          "integrate/hosts/shop-demo",
        ],
      },
      "integrate/wordpress",
    ],
  },
  { label: "In the browser", items: ["guides/in-the-browser"] },
  { label: "Deployment", items: ["guides/deployment"] },
  { label: "Security", items: ["guides/security"] },
  { label: "Reference", items: ["reference/api", "reference/contributing"] },
];

/** Every page's slug, in the sidebar's order. */
const slugs = (items) => items.flatMap((item) => (typeof item === "string" ? [item] : item.slug ? [item.slug] : slugs(item.items)));

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
    llmsTxt({
      sidebar,
      pages: ["index", ...slugs(sidebar)],
      omit: [{ page: "start/what-is-a-droplet", heading: "A note from the author" }],
    }),
    starlight({
      title,
      description,
      head: [
        meta("og:image", ogImageUrl),
        meta("og:image:width", String(ogImage.width)),
        meta("og:image:height", String(ogImage.height)),
        meta("og:image:alt", ogImage.alt),
        meta("twitter:image", ogImageUrl),
        meta("twitter:image:alt", ogImage.alt),
      ],
      customCss: [
        "@fontsource-variable/inter/wght.css",
        "@fontsource-variable/instrument-sans/wght.css",
        "@fontsource-variable/jetbrains-mono/wght.css",
        "./src/styles/custom.css",
      ],
      sidebar,
      plugins: [
        // For AI readers; src/plugins/llms-txt.mjs finishes and checks the files after the build.
        starlightLlmsTxt({
          details: llmsDetails,
          promote: ["index", ...slugs(sidebar)],
          pageSeparator: LLMS_PAGE_BREAK,
          // llms-small.txt: the core pages; the renderer and host pages are in the sets below.
          exclude: ["renderers/*", "integrate/hosts/**", "integrate/wordpress"],
          // Keeps llms-small.txt in lines, headings and tables, and the one <details>, the fragment's parts.
          minify: { whitespace: false, details: false },
          customSets: [
            {
              label: "Renderers",
              paths: ["renderers", "renderers/*"],
              description:
                "the overview and one page per renderer: Svelte, Vue, React, Preact, Solid, Hono JSX, Handlebars, Lit and plain scripts",
            },
            {
              label: "Known hosts",
              paths: ["integrate/hosts/**", "integrate/wordpress"],
              description:
                "each host example's page (nginx, Express, React + Vite, Astro, SvelteKit, Next.js, FastAPI, Sinatra, PHP, htmx), the shop demo they embed and the WordPress tutorial",
            },
          ],
          optionalLinks: [
            { label: "Source code", url: "https://github.com/dropletsjs/droplets", description: "the packages, the docs and the examples" },
            {
              label: "Framework examples",
              url: "https://github.com/dropletsjs/droplets/tree/main/examples/frameworks",
              description: "one project per renderer, with the same droplets in each",
            },
          ],
          // Screens, not text: the live droplets and the examples box (the demo's markup), the
          // heading anchors ("Section titled …"), images, videos and screenshots, the fragment
          // anatomy's mock-up, diagrams (Diagram.astro writes their description instead), and
          // .screen-only, a page's sentence about what is on screen.
          customSelectors: {
            all: [
              ".live-droplet",
              ".droplet-examples",
              ".sl-anchor-link",
              "img",
              ".droplet-tour",
              ".host-demo",
              ".host-grid",
              ".ax-mock",
              ".ax-hint",
              ".dg",
              ".screen-only",
            ],
          },
        }),
      ],
      lastUpdated: false,
      pagination: true,
    }),
  ],
});
