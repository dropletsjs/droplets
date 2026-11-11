import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fakeRenderer } from "@dropletsjs/droplets/testing";
import { droplets } from "@dropletsjs/droplets/vite";
import { createServer, type ConfigEnv, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dropletsDevtools, renderDevtoolsPage } from "../src/index.ts";

// The framework's own fixture (fake renderer): bare, docs, frame, hello and static-note, element "test-droplet".
const root = fileURLToPath(new URL("../../droplets/test/fixtures/app/", import.meta.url));

describe("dropletsDevtools", () => {
  it("applies to vite dev only: never to build or preview", () => {
    const apply = dropletsDevtools().apply as (config: object, env: ConfigEnv) => boolean;
    expect(apply({}, { command: "serve", mode: "development" })).toBe(true);
    expect(apply({}, { command: "serve", mode: "production", isPreview: true })).toBe(false);
    expect(apply({}, { command: "build", mode: "production" })).toBe(false);
  });

  it("refuses to run without the droplets plugin", async () => {
    await expect(
      createServer({ root, configFile: false, logLevel: "silent", plugins: [dropletsDevtools()] }),
    ).rejects.toThrow(/add droplets\(\)/);
  });
});

describe("renderDevtoolsPage", () => {
  it("inlines the data and the import map safely", () => {
    const html = renderDevtoolsPage({
      element: "acme-widget",
      droplets: [{ id: "x</script>", folder: "x", ssr: true, hydrate: true, hasLoad: false, hasServerLoad: false }],
      importMap: '<script type="importmap">{"imports":{"lib":"https://cdn.test/lib.js"}}</script>',
      loaderUrl: "/index.js",
      clientUrl: "/@fs/x/devtools.js",
    });
    expect(html).toContain('<script type="importmap">{"imports":{"lib":"https://cdn.test/lib.js"}}</script>');
    expect(html).toContain("&lt;acme-widget&gt;");
    expect(html).not.toContain("x</script>");
    expect(html).toContain('<script type="module" src="/index.js?injectTool=true"></script>');
  });

  it("leaves the import map out when there is none", () => {
    const html = renderDevtoolsPage({ element: "a-b", droplets: [], loaderUrl: "/index.js", clientUrl: "/c.js" });
    expect(html).not.toContain("importmap");
  });
});

describe("in vite dev", () => {
  let server: ViteDevServer;
  let origin: string;

  beforeAll(async () => {
    if (!existsSync(fileURLToPath(new URL("../dist/client/devtools-page.js", import.meta.url)))) {
      throw new Error("Build @dropletsjs/devtools first (pnpm build).");
    }
    server = await createServer({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [droplets({ renderers: [fakeRenderer()] }), dropletsDevtools()],
      // The fixture has importmap.server.ts; an external turns the map on.
      environments: { client: { build: { rolldownOptions: { external: ["case-anything"] } } } },
      server: { port: 5911, strictPort: false, host: "127.0.0.1" },
    });
    await server.listen();
    origin = server.resolvedUrls?.local[0]?.replace(/\/$/, "") ?? "";
  }, 60_000);

  afterAll(async () => {
    await server?.close();
  });

  it("serves the devtools page at / with Vite's client and the registry", async () => {
    const res = await fetch(`${origin}/?droplet=hello`);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const html = await res.text();
    expect(html).toContain("<title>Droplets devtools</title>");
    expect(html).toMatch(/<style>[^<]*--dt-panel: #ffffff;/);
    expect(html).toContain("/@vite/client");
    expect(html).toContain("&lt;test-droplet&gt;");
    const data = JSON.parse(html.match(/id="dt-data">([^<]+)</)?.[1] ?? "{}");
    expect(data.droplets.map((d: { id: string }) => d.id)).toEqual(["bare", "docs", "frame", "guestbook", "hello", "static-note"]);
    expect(data.droplets[5]).toMatchObject({ ssr: true, hydrate: false });
  });

  it("serves its browser script through Vite", async () => {
    const html = await (await fetch(`${origin}/`)).text();
    const src = html.match(/src="(\/@fs[^"]+devtools-page\.js)"/)?.[1];
    expect(src).toBeTruthy();
    const script = await fetch(`${origin}${src}`);
    expect(script.status).toBe(200);
    expect(await script.text()).toContain("droplets:registry");
  });

  const pageData = (html: string) =>
    JSON.parse(html.match(/id="dt-data">([^<]+)</)?.[1] ?? "{}") as {
      mode: string;
      server?: { status: number; method: string };
    };

  it("client mode: an empty stage, the import map in the head", async () => {
    const html = await (await fetch(`${origin}/`)).text();
    expect(pageData(html).mode).toBe("client");
    expect(html).toContain('<div id="dt-stage"></div>');
    const head = html.slice(0, html.indexOf("</head>"));
    expect(head).toContain('<script type="importmap">');
    expect(head).toContain('"/@id/case-anything"');
    // Before any module script, Vite's client included.
    expect(head.indexOf("importmap")).toBeLessThan(head.indexOf('type="module"'));
  });

  it("server mode: the droplet arrives rendered, with its styles in the head", async () => {
    const props = encodeURIComponent(JSON.stringify({ who: "Server" }));
    const html = await (await fetch(`${origin}/?droplet=hello&props=${props}`)).text();
    const data = pageData(html);
    expect(data.mode).toBe("server");
    expect(data.server).toMatchObject({ status: 200, method: "GET" });
    const stage = html.slice(html.indexOf('<div id="dt-stage">'), html.indexOf("</test-droplet>"));
    expect(stage).toContain("Hello Server!");
    expect(html).toContain('<link rel="stylesheet" href="/index.css"/>');
    expect(html).toContain('<link rel="stylesheet" href="/droplets/hello/style.css"/>');
  });

  it("server mode: POST props, and error pages as they are", async () => {
    const props = encodeURIComponent(JSON.stringify({ who: "Posted" }));
    const posted = await (await fetch(`${origin}/?droplet=hello&method=POST&props=${props}`)).text();
    expect(pageData(posted).server).toMatchObject({ status: 200, method: "POST" });
    expect(posted).toContain("Hello Posted!");

    const crash = encodeURIComponent(JSON.stringify({ who: "crash" }));
    const failed = await (await fetch(`${origin}/?droplet=hello&props=${crash}`)).text();
    expect(pageData(failed).server?.status).toBe(500);
    expect(failed).toContain("data-droplet-error");
    expect(failed).toContain("[hello] Sorry, ref 42");
  });

  it("leaves every other route to the droplets server", async () => {
    expect(await (await fetch(`${origin}/health`)).text()).toBe("ok");
    expect(await (await fetch(`${origin}/droplets/hello?who=Tool`)).text()).toContain("Hello Tool!");
    expect((await fetch(`${origin}/`, { method: "POST" })).status).toBe(404);
  });
});
