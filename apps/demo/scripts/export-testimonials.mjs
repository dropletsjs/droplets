// Exports the prerendered testimonials pages as public files of the build:
// dist/client/assets/public/testimonials/page-<n>.html, each the answer of
// GET /droplets/testimonials-prerender-only?page=<n>. The stored renders are
// private to the server; these copies are static assets, so Cloudflare
// serves them by path without a Worker invocation.
//
//   node scripts/export-testimonials.mjs [outDir]   # default: dist
//
// It asks the build itself: dist/server.js (Node) or dist/worker.js (the
// Worker, run in Node with an ASSETS binding that reads dist/client), so the
// files are byte-equal to what that server answers.
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, normalize, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const LOCATION = "https://demo.dropletsjs.dev";
const DROPLET = "testimonials-prerender-only";
const PAGES = 10;

const out = resolve(process.argv[2] ?? "dist");
const client = join(out, "client");
const target = join(client, "assets/public/testimonials");

/** Workers Static Assets, as the Worker reads it: a file of dist/client by path, else 404. */
function assetsBinding() {
  return {
    async fetch(input) {
      const path = normalize(decodeURIComponent(new URL(input instanceof Request ? input.url : String(input)).pathname));
      const file = join(client, path);
      if (!file.startsWith(client + sep) || !existsSync(file)) return new Response("Not Found", { status: 404 });
      return new Response(await readFile(file));
    },
  };
}

async function answerer() {
  const server = join(out, "server.js");
  if (existsSync(server)) {
    const app = (await import(pathToFileURL(server).href)).default;
    return (request) => app.fetch(request);
  }
  const worker = join(out, "worker.js");
  if (existsSync(worker)) {
    const app = (await import(pathToFileURL(worker).href)).default;
    const env = { ASSETS: assetsBinding() };
    const ctx = { waitUntil() {}, passThroughOnException() {} };
    return (request) => app.fetch(request, env, ctx);
  }
  throw new Error(`no server.js or worker.js in ${out}: build first`);
}

const answer = await answerer();
await mkdir(target, { recursive: true });
for (let page = 1; page <= PAGES; page++) {
  const url = `${LOCATION}/droplets/${DROPLET}?page=${page}`;
  const response = await answer(new Request(url));
  const html = await response.text();
  if (response.status !== 200 || !html.startsWith(`<djs-demo data-droplet="${DROPLET}"`)) {
    throw new Error(`${url} answered ${response.status}, not the fragment:\n${html.slice(0, 300)}`);
  }
  await writeFile(join(target, `page-${page}.html`), html);
}
console.log(`[export-testimonials] ${PAGES} pages in ${target}`);
process.exit(0);
