// A host page on another origin (:8100) than the droplets servers (8400 and
// up), as the examples/hosts/* pages are: it fetches each fragment on the
// server and loads that server's /index.js once. `/<example>/` embeds one
// example's three droplets; `/<example>/written` has elements the host wrote
// itself, with no fragment: those droplets mount in the browser.
// `/svelte/script` embeds the Svelte example's script droplet twice.
// `/<example>/inserted` fetches a fragment in the browser and inserts it with
// innerHTML; `/<example>/one/<id>?props` embeds one droplet.
// `/<example>/mfe/*` is a proxy to that example's server under a path
// prefix, on this origin, as a host's reverse proxy is; `/<example>/prefixed`
// embeds the three droplets through it.
import { createServer } from "node:http";

const EXAMPLES = ["svelte", "vue", "react", "solid", "hono-jsx", "handlebars", "preact", "lit"];
const PORT = Number(process.env["HOST_PORT"] ?? 8100);
const MODES = ["client", "ssr-hydrate", "ssr-nohydrate"];
const dropletsOf = (example) => `http://localhost:${8400 + EXAMPLES.indexOf(example)}`;

async function fragment(droplets, id, props, location = droplets) {
  const url = new URL(`/droplets/${id}`, droplets);
  for (const [key, value] of Object.entries(props)) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: { "x-droplet-location": location } });
  // A 500 with HTML is the droplet's error page: embedded like any fragment.
  const isHtml = (response.headers.get("content-type") ?? "").includes("text/html");
  if (!response.ok && !isHtml) return `<p class="error">${id}: HTTP ${response.status}</p>`;
  return response.text();
}

const page = (droplets, title, body) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
<script type="module" src="${droplets}/index.js"></script>
</head>
<body style="font-family: system-ui; background: #f1f5f9; margin: 0; padding: 1rem;">
<h1>${title}</h1>
${body}
</body>
</html>
`;

const html = (response, text) => response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(text);

const PASSED = ["content-type", "cache-control", "etag", "location", "vary", "link", "set-cookie"];

/** `/<example>/mfe/<path>` to `<droplets>/<path>`, telling the server where it is reached. */
async function proxy(request, response, droplets, prefix, path) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = request.method === "GET" || request.method === "HEAD" ? undefined : Buffer.concat(chunks);
  const headers = { "x-droplet-location": prefix };
  for (const name of ["content-type", "accept", "origin", "referer", "if-none-match", "cookie"]) {
    const value = request.headers[name];
    if (typeof value === "string") headers[name] = value;
  }
  const answer = await fetch(`${droplets}/${path}`, { method: request.method, headers, body, redirect: "manual" });
  const out = {};
  for (const name of PASSED) {
    const value = answer.headers.get(name);
    if (value !== null) out[name] = value;
  }
  response.writeHead(answer.status, out).end(Buffer.from(await answer.arrayBuffer()));
}

createServer(async (request, response) => {
  const { pathname } = new URL(request.url ?? "/", "http://host");
  if (pathname === "/health") {
    response.writeHead(200).end("ok");
    return;
  }
  const [, example, rest] = /^\/([a-z-]+)\/(.*)$/.exec(pathname) ?? [];
  if (!example || !EXAMPLES.includes(example)) {
    response.writeHead(404).end("not found");
    return;
  }
  const droplets = dropletsOf(example);
  const prefix = `http://localhost:${PORT}/${example}/mfe`;
  if (rest?.startsWith("mfe/")) {
    const { search } = new URL(request.url ?? "/", "http://host");
    await proxy(request, response, droplets, prefix, rest.slice("mfe/".length) + search);
    return;
  }
  if (rest === "prefixed") {
    const fragments = await Promise.all(MODES.map((id) => fragment(droplets, id, { who: "Prefix" }, prefix)));
    html(response, page(prefix, `Every ${example} droplet, behind a prefix`, fragments.join("\n")));
    return;
  }
  if (rest === "") {
    const fragments = await Promise.all(MODES.map((id) => fragment(droplets, id, { who: "Host" })));
    html(response, page(droplets, `Every ${example} droplet`, fragments.join("\n")));
    return;
  }
  // The Svelte example's script droplet, twice on one page: a page-view tracker.
  if (rest === "script" && example === "svelte") {
    const trackers = await Promise.all([1, 2].map(() => fragment(droplets, "page-views", { page: "pricing" })));
    html(response, page(droplets, "A script droplet", trackers.join("\n")));
    return;
  }
  if (rest === "written") {
    html(
      response,
      page(
        droplets,
        "Written by the host",
        `<djs-${example} data-droplet="ssr-hydrate" data-droplet-props='{"who":"Writer"}'></djs-${example}>`,
      ),
    );
    return;
  }
  // The fragment fetched by the page itself and inserted with innerHTML, as
  // many hosts do: no parser runs on it, so a declarative shadow root stays an
  // inert <template> until the droplet's renderer attaches it.
  if (rest === "inserted") {
    const script = `<script type="module">
const response = await fetch(${JSON.stringify(`${droplets}/droplets/ssr-hydrate?who=Inserted`)});
document.getElementById("box").innerHTML = await response.text();
</script>`;
    html(response, page(droplets, "Inserted with innerHTML", `<div id="box"></div>\n${script}`));
    return;
  }
  // One droplet's fragment, on the server, by id and props: `/<example>/one/guestbook?who=Ana`.
  // `hydrate=interactive` is the host's own `data-droplet-hydrate` on the element, not a prop.
  const one = /^one\/([a-z-]+)$/.exec(rest ?? "");
  if (one) {
    const { searchParams } = new URL(request.url ?? "/", "http://host");
    const hydrate = searchParams.get("hydrate");
    searchParams.delete("hydrate");
    let body = await fragment(droplets, one[1], Object.fromEntries(searchParams));
    if (hydrate && /^[a-z]+$/.test(hydrate)) body = body.replace(`<djs-${example} `, `<djs-${example} data-droplet-hydrate="${hydrate}" `);
    html(response, page(droplets, `The ${one[1]} droplet`, body));
    return;
  }
  response.writeHead(404).end("not found");
}).listen(PORT);
