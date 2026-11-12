import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The files starlight-llms-txt writes, finished for an AI reader after the
 * build: llms.txt becomes an index of every page, and in llms-full.txt,
 * llms-small.txt and the custom sets every page gets its URL, links become
 * absolute, tables lose their padding and media-only headings go. Then the
 * outputs are checked, and the build fails on a page missing from the index,
 * a page outside the sidebar, a root-relative link, an image or a diagram's
 * button labels.
 */

/** `pageSeparator` of the plugin, so pages can be told apart here; replaced by a blank line. */
export const LLMS_PAGE_BREAK = "\n\n<!-- llms-txt: page -->\n\n";

/** The `details` of llms.txt: what an AI needs before it opens a page. No headings, by the llms.txt format. */
export const llmsDetails = `Droplets is a Vite 8 plugin, \`@dropletsjs/droplets\`, that builds a folder of components into a small Hono server. Each component, a droplet, has its own URL: a host page on any stack fetches the droplet's server-rendered HTML fragment, pastes it in and loads one script, \`/index.js\`, which defines the droplet element and hydrates the droplets that need it. Droplets are written in Svelte, Vue, React, Preact, Solid, Hono JSX, Handlebars or Lit, or as a plain script, and one project can mix them. The server runs on Node, Bun, Deno or Cloudflare Workers. The authoring model follows SvelteKit (\`+\` files, \`load\`, form actions, hooks), but Droplets is its own project with its own rules: read the pages rather than assume SvelteKit's behaviour.

The essentials, each detailed in the pages listed below:

- A droplet is a folder \`src/droplets/<id>/\`, the id lowercase kebab-case. \`+droplet.<ext>\` is the component (\`.svelte\`, \`.vue\`, \`.tsx\`, \`.hbs\`, \`.lit.ts\`), or \`+droplet.script.ts\` plain browser code; \`+droplet.server.ts\` holds the server \`load\`, \`actions\`, \`handleError\`, \`entries\` and \`transform\`; \`+droplet.ts\` the \`props\` schema and a \`load\` that runs on both sides; \`+error.<ext>\` the error page.
- The flags \`ssr\`, \`hydrate\` (\`true\`, \`false\`, \`"visible"\`, \`"interactive"\`) and \`prerender\` are exported from the component alone; anywhere else they are ignored.
- Routes: \`GET /droplets/<id>\` answers the fragment (props from the query), \`POST /droplets/<id>\` takes \`{ props, host }\` as JSON, \`POST /droplets/<id>?/<name>\` runs an action, \`GET /droplets/<id>/_data\` answers the load's result as JSON. \`/index.js\`, \`/index.css\`, \`/env.js\` and \`/assets/*\` (the project's \`public/\` under \`/assets/public/*\`) are the build's files; \`/api/*\` serves \`src/api/**/+server.ts\`.
- The fragment is one custom element, \`<djs-droplet>\` unless the \`element\` option renames it. Every attribute the framework reads or writes is \`data-droplet\` (the id) or \`data-droplet-*\`; request headers are \`x-droplet-*\` (\`x-droplet-location\`, \`x-droplet-props\`), response headers \`x-droplets-*\`.
- The droplet location, where the browser reaches the droplets server, is computed per request from a trusted \`x-droplet-location\`, \`Forwarded\` or \`X-Forwarded-*\` header, else the request's own origin, or fixed at build with \`location\`. Every URL a droplet emits for its own files is on it.
- Server code (\`*.server.*\` files, \`server/\` folders, \`+server.*\` routes) never reaches a browser bundle: the build fails and names the import chain.
- The framework reads the environment variables \`DROPLETS_TRUSTED_ORIGINS\`, \`DROPLETS_SECRET\`, \`DROPLETS_ENV_MAX_AGE\`, \`PORT\` and \`DEV_DROPLETS_LOG\`, no others; a project declares its own in \`src/env.ts\` and reads them from \`$droplets/env/public\` and \`$droplets/env/private\`.
- Packages: \`@dropletsjs/droplets\` (the plugin, the runtime and the \`djs\` command), \`@dropletsjs/renderer-<framework>\`, \`@dropletsjs/adapter-<node|bun|deno|cloudflare>\` (a build needs one) and \`@dropletsjs/devtools\`. \`npm create droplets\` starts a project, \`djs add\` adds a droplet.`;

/** Text the pages' interactive parts would leave behind; none of it may reach an output. */
const UI_STRINGS = ["Full screen", "Download as SVG", "Section titled", "Hover, focus or tap"];

/**
 * @param {object} options
 * @param {unknown[]} options.sidebar Starlight's sidebar: the sections and the order of llms.txt.
 * @param {string[]} options.pages Every page's slug, in the order of `promote`.
 * @param {{ page: string, heading: string }[]} [options.omit] Sections left out of every output.
 */
export function llmsTxt({ sidebar, pages, omit = [] }) {
  let site = "";
  let prefix = "";
  let contentDir = "";
  return {
    name: "droplets:llms-txt",
    hooks: {
      "astro:config:done": ({ config }) => {
        site = String(config.site);
        prefix = config.base.replace(/\/+$/, "");
        contentDir = fileURLToPath(new URL("./src/content/docs/", config.root));
      },
      "astro:build:done": async ({ dir }) => {
        const out = fileURLToPath(dir);
        const urlOf = (slug) => new URL(`${prefix}/${slug === "index" ? "" : `${slug}/`}`, site).href;
        const read = (file) => readFile(join(out, file), "utf8");

        const full = splitPages(await read("llms-full.txt"));
        if (full.pages.length !== pages.length) {
          const known = new Set(pages);
          const strays = (await contentSlugs({ root: contentDir })).filter((slug) => !known.has(slug));
          throw new Error(
            `llms-txt: llms-full.txt has ${full.pages.length} pages, the sidebar ${pages.length}. ` +
              `Every page must be in the sidebar of astro.config.mjs${strays.length ? `; missing: ${strays.join(", ")}` : ""}.`,
          );
        }
        /** @type {Map<string, { slug: string, title: string, summary: string }>} */
        const byTitle = new Map();
        const bySlug = new Map();
        full.pages.forEach((text, i) => {
          const page = { slug: pages[i], ...headOf(text) };
          if (byTitle.has(page.title)) throw new Error(`llms-txt: two pages are titled "${page.title}"`);
          byTitle.set(page.title, page);
          bySlug.set(page.slug, page);
        });

        const finish = ({ system, pages: texts }) =>
          [
            system,
            ...texts.map((text) => {
              const page = byTitle.get(headOf(text).title);
              if (!page) throw new Error(`llms-txt: no page titled "${headOf(text).title}"`);
              const url = urlOf(page.slug);
              const absolute = (href) => (href.startsWith("#") ? `${url}${href}` : new URL(`${prefix}${href}`, site).href);
              return finishPage({ text, page, url, absolute, omit });
            }),
          ].join("\n\n") + "\n";

        const small = splitPages(await read("llms-small.txt"));
        const kept = new Set(small.pages.map((text) => headOf(text).title));
        const leftOut = full.pages.map((text) => headOf(text).title).filter((title) => !kept.has(title));
        if (leftOut.length) {
          small.system = small.system.replace(
            /<\/SYSTEM>$/,
            `. It leaves out these pages, which ${new URL(`${prefix}/llms.txt`, site).href} lists with the files that hold them: ${leftOut.join(", ")}.</SYSTEM>`,
          );
        }

        const sets = (await readdir(join(out, "_llms-txt")).catch(() => [])).filter((file) => file.endsWith(".txt"));
        const outputs = {
          "llms-full.txt": finish(full),
          "llms-small.txt": finish(small),
          ...Object.fromEntries(
            await Promise.all(sets.map(async (file) => [`_llms-txt/${file}`, finish(splitPages(await read(`_llms-txt/${file}`)))])),
          ),
        };
        outputs["llms.txt"] = indexFile({
          generated: await read("llms.txt"),
          summary: bySlug.get("index")?.summary,
          sections: sidebarSections({ sidebar, bySlug, urlOf }),
          leftOut,
        });

        check({ outputs, index: outputs["llms.txt"], pages: pages.filter((slug) => slug !== "index").map(urlOf) });
        for (const [file, text] of Object.entries(outputs)) await writeFile(join(out, file), text);
      },
    },
  };
}

/** The plugin's output as its `<SYSTEM>` line and one text per page. */
function splitPages(text) {
  const [system = "", ...pages] = text.split(LLMS_PAGE_BREAK);
  if (!system.startsWith("<SYSTEM>"))
    throw new Error("llms-txt: an output does not start with <SYSTEM>; is pageSeparator LLMS_PAGE_BREAK?");
  return { system: system.trim(), pages };
}

/** The `# Title` and the `> summary` the plugin starts every page with. */
function headOf(text) {
  const [first = "", , third = ""] = text.split("\n");
  if (!first.startsWith("# ")) throw new Error(`llms-txt: a page does not start with its title: ${first.slice(0, 80)}`);
  return { title: first.slice(2).trim(), summary: third.startsWith("> ") ? third.slice(2).trim() : "" };
}

function finishPage({ text, page, url, absolute, omit }) {
  let lines = text.split("\n");
  for (const { heading } of omit.filter((entry) => entry.page === page.slug)) lines = omitSection({ lines, heading, page });

  const fenced = fenceMap(lines);
  lines = lines.map((line, i) => {
    if (fenced[i]) return line;
    const linked = line.replace(/\]\((\/(?!\/)[^)\s]*|#[^)\s]*)\)/g, (_, href) => `](${absolute(href)})`);
    return isTableRow(linked) ? unpadRow(linked) : linked;
  });
  lines = dropEmptyHeadings({ lines, fenced: fenceMap(lines) });
  lines.splice(1, 0, "", `Source: ${url}`);
  return squeezeBlankLines(lines).join("\n").trim();
}

/** For each line, whether it is inside a fenced code block (the fences included). */
function fenceMap(lines) {
  let open = null;
  return lines.map((line) => {
    const fence = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (open) {
      if (fence && fence[0] === open[0] && fence.length >= open.length && line.trim() === fence) open = null;
      return true;
    }
    if (fence) open = fence;
    return Boolean(fence);
  });
}

function isTableRow(line) {
  const trimmed = line.trim();
  return trimmed.length > 1 && trimmed.startsWith("|") && trimmed.endsWith("|");
}

/** `|  a   | b  |` → `| a | b |`; a delimiter row keeps its alignment colons. */
function unpadRow(line) {
  const indent = /^\s*/.exec(line)?.[0] ?? "";
  const body = line.trim().slice(1, -1);
  const cells = [];
  let cell = "";
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "\\" && i + 1 < body.length) {
      cell += body[i] + body[i + 1];
      i++;
    } else if (body[i] === "|") {
      cells.push(cell);
      cell = "";
    } else cell += body[i];
  }
  cells.push(cell);
  const trimmed = cells.map((c) => c.trim());
  const delimiter = trimmed.every((c) => /^:?-+:?$/.test(c));
  const out = delimiter ? trimmed.map((c) => `${c.startsWith(":") ? ":" : ""}---${c.endsWith(":") ? ":" : ""}`) : trimmed;
  return `${indent}|${out.map((c) => (c ? ` ${c} ` : " ")).join("|")}|`;
}

const headingLevel = (line) => /^(#{1,6}) /.exec(line)?.[1].length ?? 0;

/** Removes a heading and its section, up to the next heading of the same level or higher. */
function omitSection({ lines, heading, page }) {
  const fenced = fenceMap(lines);
  const start = lines.findIndex((line, i) => !fenced[i] && headingLevel(line) > 1 && line.replace(/^#+ /, "").trim() === heading);
  if (start < 0) throw new Error(`llms-txt: no heading "${heading}" on ${page.slug} to leave out (omit in astro.config.mjs)`);
  const level = headingLevel(lines[start]);
  let end = start + 1;
  while (end < lines.length && (fenced[end] || !headingLevel(lines[end]) || headingLevel(lines[end]) > level)) end++;
  return [...lines.slice(0, start), ...lines.slice(end)];
}

/** A heading whose section held only media is followed by another heading of its level or higher, or by nothing. */
function dropEmptyHeadings({ lines, fenced }) {
  const keep = lines.map(() => true);
  // What follows the line at hand: "end", 0 for content, or a heading's level.
  let next = "end";
  for (let i = lines.length - 1; i >= 1; i--) {
    if (!lines[i].trim()) continue;
    const level = fenced[i] ? 0 : headingLevel(lines[i]);
    if (level && (next === "end" || (next > 0 && next <= level))) keep[i] = false;
    else next = level;
  }
  return lines.filter((_, i) => keep[i]);
}

/** One blank line at most, in prose and in code: the converter doubles a code block's blank lines. */
function squeezeBlankLines(lines) {
  return lines.filter((line, i) => line.trim() !== "" || (lines[i - 1] ?? "").trim() !== "");
}

/** The sidebar as llms.txt sections: one per top-level group, a nested list for a nested group. */
function sidebarSections({ sidebar, bySlug, urlOf }) {
  const entry = (slug, indent) => {
    const page = bySlug.get(slug);
    if (!page) throw new Error(`llms-txt: the sidebar names ${slug}, which is not in llms-full.txt`);
    return `${indent}- [${page.title}](${urlOf(slug)})${page.summary ? `: ${page.summary}` : ""}`;
  };
  const items = (list, indent) =>
    list.flatMap((item) =>
      typeof item === "string"
        ? [entry(item, indent)]
        : item.slug
          ? [entry(item.slug, indent)]
          : [`${indent}- ${item.label}:`, ...items(item.items, `${indent}  `)],
    );
  return sidebar.map((group) => `## ${group.label}\n\n${items(group.items, "").join("\n")}`);
}

/** llms.txt: the plugin's title and links, the home page's summary, the page index; its boilerplate notes go. */
function indexFile({ generated, summary, sections, leftOut }) {
  const parts = generated.trim().split(/\n(?=## )/);
  const [head = "", ...rest] = parts;
  const sets = rest.find((part) => part.startsWith("## Documentation Sets")) ?? "";
  const optional = rest.find((part) => part.startsWith("## Optional"));
  const title = head.split("\n")[0];
  const details = head
    .split("\n")
    .slice(1)
    .join("\n")
    .trim()
    .replace(/^> .*\n*/, "");
  const links = sets.split("\n").filter((line) => line.startsWith("- ["));
  const full = links.find((line) => line.includes("/llms-full.txt)"));
  const small = links.find((line) => line.includes("/llms-small.txt)"));
  const described = [
    full?.replace(/\): .*$/, "): every page below, in this order, each starting with its title, its URL and a one-line summary"),
    small?.replace(
      /\): .*$/,
      `): the same without notes and tips${leftOut.length ? `, and without these pages, which the sets below hold: ${leftOut.join(", ")}` : ""}`,
    ),
    ...links.filter((line) => line !== full && line !== small),
  ].filter(Boolean);
  return `${[title, summary ? `> ${summary}` : "", details, `## Documentation sets\n\n${described.join("\n")}`, ...sections, optional ?? ""]
    .filter(Boolean)
    .join("\n\n")}\n`;
}

function check({ outputs, index, pages }) {
  const problems = [];
  for (const url of pages) if (!index.includes(`](${url})`)) problems.push(`llms.txt does not list ${url}`);
  for (const [file, text] of Object.entries(outputs)) {
    if (file === "llms.txt") continue;
    const lines = text.split("\n");
    const fenced = fenceMap(lines);
    lines.forEach((line, i) => {
      if (fenced[i]) return;
      if (/\]\((?![a-z][a-z0-9+.-]*:)/i.test(line)) problems.push(`${file}:${i + 1} has a relative link: ${line.slice(0, 120)}`);
      if (/!\[[^\]]*\]\(/.test(line)) problems.push(`${file}:${i + 1} has an image: ${line.slice(0, 120)}`);
      for (const ui of UI_STRINGS) if (line.includes(ui)) problems.push(`${file}:${i + 1} has the UI text "${ui}"`);
    });
  }
  if (problems.length) throw new Error(`llms-txt:\n  ${problems.slice(0, 30).join("\n  ")}`);
}

/** The slug of every page in src/content/docs, as Starlight names it. */
async function contentSlugs({ root, dir = root }) {
  const slugs = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) slugs.push(...(await contentSlugs({ root, dir: path })));
    else if (/\.mdx?$/.test(entry.name)) {
      const slug = relative(root, path)
        .replace(/\.mdx?$/, "")
        .replace(/\/index$/, "");
      slugs.push(slug);
    }
  }
  return slugs;
}
