/**
 * Every URL a droplet writes for its own files is on the droplet location
 * (where `/index.js` is served from, prefix included), in a build and in
 * `vite dev`: imported files, `new URL(…, import.meta.url)`, CSS `url()`,
 * chunk preloads, `droplet.url()` and `public/`.
 */
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createBuilder, createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fakeRenderer } from "../../src/testing/index.ts";
import { droplets, type DropletsAdapter } from "../../src/vite.ts";

const fixtures = fileURLToPath(new URL("../fixtures/", import.meta.url));

const fakeAdapter: DropletsAdapter = {
  name: "fake",
  serverEntry: resolve(fixtures, "app/fake-entry.js"),
  serverFile: "server.js",
  separateSsrBundle: true,
};

// Twice Vite's inline limit: a file, never a data: URL.
const png = (fill: number) => Buffer.alloc(9000, fill);

const COMPONENT = `import logo from "./logo.png";
import droplet from "$droplets/drop";
import "./pics.css";

export const ssr = true;
export const hydrate = true;

const fromUrl = new URL("./logo.png", import.meta.url).href;
const robots = droplet.url("assets/public/robots.txt");

export default () =>
  \`<img id="imported" src="\${logo}"><img id="from-url" src="\${fromUrl}">\` +
  \`<a id="robots" href="\${robots}">robots</a><a id="drop" href="\${droplet.url(logo)}">logo</a>\`;

export function attach(target) {
  target.dataset.lazy = "loading";
  import("./lazy.js").then((lazy) => { target.dataset.lazy = lazy.name; });
}
`;

/** A project with one droplet that names its files every way there is, and a public/ folder. */
async function project(): Promise<string> {
  const root = await mkdtemp(join(fixtures, ".assets-"));
  const folder = join(root, "src/droplets/pics");
  await mkdir(folder, { recursive: true });
  await mkdir(join(root, "public/img"), { recursive: true });
  await writeFile(join(folder, "+droplet.fake.js"), COMPONENT);
  await writeFile(join(folder, "logo.png"), png(1));
  await writeFile(join(folder, "bg.png"), png(2));
  await writeFile(join(folder, "pics.css"), ".pics { background: url(./bg.png); }\n.pub { background: url(/img/a.png); }\n");
  await writeFile(join(folder, "lazy.js"), 'import "./lazy.css";\nexport const name = "lazy";\n');
  await writeFile(join(folder, "lazy.css"), ".lazy { color: red; }\n");
  await writeFile(join(root, "public/robots.txt"), "User-agent: *\n");
  await writeFile(join(root, "droplets.config.ts"), 'export default { trustedOrigins: ["https://host.example"] };\n');
  await writeFile(join(root, "public/img/a.png"), png(3));
  return root;
}

async function files(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) out.push(join(entry.parentPath, entry.name).slice(dir.length + 1));
  }
  return out;
}

const attr = (html: string, id: string, name: "src" | "href") => new RegExp(`id="${id}" ${name}="([^"]+)"`).exec(html)?.[1];

const roots: string[] = [];
afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

describe("file URLs in a build", () => {
  let root: string;
  let dist: string;

  beforeAll(async () => {
    root = await project();
    roots.push(root);
    dist = join(root, "dist");
    const builder = await createBuilder({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [droplets({ adapter: fakeAdapter, renderers: [fakeRenderer()] })],
    });
    await builder.buildApp();
  }, 120_000);

  /** The built server, answering as an adapter would. */
  async function serve() {
    const { createServerApp, resolveConfig } = await import("../../src/index.ts");
    const ssr = await import(pathToFileURL(join(dist, "server/entry-server.js")).href);
    return createServerApp({
      ssr,
      config: resolveConfig({ trustedOrigins: ["https://host.example"] }),
      assets: {
        buildHash: "x",
        loadClientModule: async () => null,
        loadEntryClient: async () => null,
        entryModule: async () => null,
        loadGlobalStyle: async () => null,
        dropletStyles: async () => [],
        loadIndex: async () => null,
        externals: [],
        assetHandler: (c) => c.text("Not Found", 404),
      },
    });
  }

  it("renders imported files, new URL(…, import.meta.url) and droplet.url() on each request's location", async () => {
    const app = await serve();
    const render = async (headers: Record<string, string> = {}) =>
      (await app.request("http://drops.test/droplets/pics", { headers })).text();

    const own = await render();
    expect(attr(own, "imported", "src")).toMatch(/^http:\/\/drops\.test\/assets\/logo-[\w-]+\.png$/);
    expect(attr(own, "from-url", "src")).toBe(attr(own, "imported", "src"));
    expect(attr(own, "drop", "href")).toBe(attr(own, "imported", "src"));
    expect(attr(own, "robots", "href")).toBe("http://drops.test/assets/public/robots.txt");

    // A host page on another origin, behind a proxy's prefix.
    const prefixed = await render({ "x-droplet-location": "https://host.example/mfe" });
    expect(attr(prefixed, "imported", "src")).toMatch(/^https:\/\/host\.example\/mfe\/assets\/logo-[\w-]+\.png$/);
    expect(attr(prefixed, "from-url", "src")).toBe(attr(prefixed, "imported", "src"));
    expect(attr(prefixed, "drop", "href")).toBe(attr(prefixed, "imported", "src"));
    // At the module's top level, outside any request: the token, replaced per response.
    expect(attr(prefixed, "robots", "href")).toBe("https://host.example/mfe/assets/public/robots.txt");

    for (const html of [own, prefixed]) {
      expect(html).not.toContain("file://");
      expect(html).not.toContain("DROPLET_");
      expect(html).not.toMatch(/(src|href)="\/assets\//);
    }
  });

  it("writes the server bundle's file URLs on its own location token, never on the disk or the root", async () => {
    const ssr = await readFile(join(dist, "server/entry-server.js"), "utf8");
    const { tokenNonce } = (await import(pathToFileURL(join(dist, "server/entry-server.js")).href)) as { tokenNonce: string };
    expect(tokenNonce).toMatch(/^[0-9a-f]+$/);
    expect(ssr).toContain(`http://droplets.invalid/__$DROPLET_LOCATION_${tokenNonce}$__/assets/logo-`);
    expect(ssr).not.toContain("__DROPLETS_SERVER_LOCATION__");
    expect(ssr).not.toMatch(/["']\/assets\/logo-/);
  });

  it("writes browser bundles' file URLs relative to the file that names them, preloads included", async () => {
    const client = join(dist, "client");
    const js = await readFile(join(client, "droplets/pics/client.js"), "utf8");
    expect(js).toMatch(/new URL\(([`"'])\.\.\/\.\.\/assets\/logo-[\w-]+\.png\1,\s*import\.meta\.url\)/);
    expect(js).not.toMatch(/["']\/assets\//);
    expect(js).not.toContain("__DROPLETS_BUILD_ROOT__");

    // The dynamic import's stylesheet preload: resolved against the importing chunk, prefix kept.
    const chunks = (await files(client)).filter((file) => file.endsWith(".js")).map((file) => join(client, file));
    const all = (await Promise.all(chunks.map((file) => readFile(file, "utf8")))).join("\n");
    const listed = JSON.parse(/m\.f=(\[[^\]]*\])/.exec(all)?.[1] ?? "[]") as string[];
    expect(
      listed.some((dep) => /lazy-[\w-]+\.css$/.test(dep)),
      all.slice(0, 400),
    ).toBe(true);
    for (const dep of listed) expect(dep).not.toMatch(/^\//);
    expect(all).not.toContain("__DROPLETS_BUILD_ROOT__");

    // CSS url(): relative to the stylesheet, which lives in assets/.
    const css = (await files(client)).filter((file) => file.endsWith(".css"));
    const sheets = (await Promise.all(css.map((file) => readFile(join(client, file), "utf8")))).join("\n");
    expect(sheets).toMatch(/url\(\.\/bg-[\w-]+\.png\)/);
    expect(sheets).toContain("url(./public/img/a.png)");
    expect(sheets).not.toMatch(/url\(\/(assets|img)\//);
    expect(new URL("./public/img/a.png", "https://host.example/mfe/assets/pics-x.css").href).toBe(
      "https://host.example/mfe/assets/public/img/a.png",
    );
  });

  it("copies public/ into the client build's assets/public/ alone", async () => {
    expect(await readFile(join(dist, "client/assets/public/robots.txt"), "utf8")).toBe("User-agent: *\n");
    expect(existsSync(join(dist, "client/assets/public/img/a.png"))).toBe(true);
    expect(existsSync(join(dist, "client/robots.txt"))).toBe(false);
    expect((await files(join(dist, "server"))).filter((file) => file.includes("robots"))).toEqual([]);
    expect(existsSync(join(dist, "robots.txt"))).toBe(false);
  });
});

describe("file URLs in vite dev", () => {
  let root: string;
  let server: ViteDevServer;
  let origin: string;

  beforeAll(async () => {
    root = await project();
    roots.push(root);
    server = await createServer({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [droplets({ renderers: [fakeRenderer()] })],
      server: { port: 5931, strictPort: false, host: "127.0.0.1" },
    });
    await server.listen();
    origin = server.resolvedUrls?.local[0]?.replace(/\/$/, "") ?? "";
  }, 60_000);

  afterAll(async () => {
    await server?.close();
  });

  it("renders file URLs absolute to the dev server, so a page on another origin loads them", async () => {
    const html = await (await fetch(`${origin}/droplets/pics`, { headers: { "x-droplet-location": "https://host.example/mfe" } })).text();
    const port = new URL(origin).port;
    const imported = attr(html, "imported", "src");
    expect(imported).toMatch(new RegExp(`^http://(localhost|127\\.0\\.0\\.1):${port}/src/droplets/pics/logo\\.png`));
    expect(attr(html, "from-url", "src")).toMatch(new RegExp(`^http://(localhost|127\\.0\\.0\\.1):${port}/src/droplets/pics/logo\\.png`));
    expect(attr(html, "robots", "href")).toBe("https://host.example/mfe/assets/public/robots.txt");
    // A module's top level runs outside any request: no first request's location sticks.
    const other = await (await fetch(`${origin}/droplets/pics`)).text();
    expect(attr(other, "robots", "href")).toBe(`${origin}/assets/public/robots.txt`);
    expect(html).not.toContain("file://");
    expect(html).not.toContain("DROPLET_");
    expect((await fetch((imported ?? expect.unreachable("#imported src")).replace("localhost", "127.0.0.1"))).status).toBe(200);
  });

  it("serves public/ at /assets/public/, no-cache with an ETag, 304 when it matches", async () => {
    const res = await fetch(`${origin}/assets/public/robots.txt`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("User-agent: *\n");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    const etag = res.headers.get("etag") ?? expect.unreachable("an etag");
    expect(etag).toBeTruthy();
    expect((await fetch(`${origin}/assets/public/robots.txt`, { headers: { "if-none-match": etag } })).status).toBe(304);
  });
});
