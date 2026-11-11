import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Prefixes root-relative links in the built pages with Astro's `base`, so the
 * Markdown pages can link to `/guides/configuration/` and still work when the
 * site is served from a sub-path (`DOCS_BASE`, as on a project site like
 * `https://<owner>.github.io/<repo>/`). Starlight's own links already carry
 * the base; links to other origins, anchors and relative links are left
 * alone. Runs on the build output, so it does not depend on the Markdown
 * processor; `astro dev` serves at `/` and needs nothing.
 */
export function baseLinks() {
  let prefix = "";
  return {
    name: "droplets:base-links",
    hooks: {
      "astro:config:done": ({ config }) => {
        prefix = config.base.replace(/\/+$/, "");
      },
      "astro:build:done": async ({ dir }) => {
        if (!prefix) return;
        const link = /(<a\s[^>]*?href=")(\/(?!\/)[^"]*)"/g;
        for (const file of await htmlFiles(fileURLToPath(dir))) {
          const html = await readFile(file, "utf8");
          const fixed = html.replace(link, (whole, start, href) =>
            href === prefix || href.startsWith(`${prefix}/`) ? whole : `${start}${prefix}${href}"`,
          );
          if (fixed !== html) await writeFile(file, fixed);
        }
      },
    },
  };
}

async function htmlFiles(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await htmlFiles(path)));
    else if (entry.name.endsWith(".html")) files.push(path);
  }
  return files;
}
