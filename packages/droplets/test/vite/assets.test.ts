import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hostTokens } from "../../src/runtime/host.ts";
import { assetUrlsPlugin, type BuiltUrlContext, builtUrl, publicFileHandler, rewriteFileUrls } from "../../src/vite/assets.ts";
import { createInitialState } from "../../src/vite/state.ts";

const context = (fields: Partial<BuiltUrlContext>): BuiltUrlContext =>
  ({ type: "asset", hostId: "droplets/pics/client.js", hostType: "js", ssr: false, ...fields }) as BuiltUrlContext;

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "droplets-assets-"));
  await mkdir(join(dir, "public/img"), { recursive: true });
  await writeFile(join(dir, "public/robots.txt"), "User-agent: *\n");
  await writeFile(join(dir, "public/img/a.png"), "png");
  await writeFile(join(dir, "logo.png"), "png");
});
afterAll(() => rm(dir, { recursive: true, force: true }));

describe("builtUrl", () => {
  const url = builtUrl({ user: undefined });

  it("writes a browser bundle's files relative to the file that names them", () => {
    expect(url("assets/logo.abc.png", context({}))).toEqual({ relative: true });
    expect(url("assets/logo.abc.png", context({ hostType: "css", hostId: "pics.css" }))).toEqual({ relative: true });
  });

  it("puts public/ under assets/public/, relative to the JavaScript or the stylesheet", () => {
    expect(url("img/a.png", context({ type: "public" }))).toEqual({
      runtime: 'new URL("../../assets/public/img/a.png", import.meta.url).href',
    });
    // A stylesheet lands in assets/, whatever its hostId says.
    expect(url("img/a.png", context({ type: "public", hostType: "css", hostId: "pics.css" }))).toBe("./public/img/a.png");
  });

  it("writes a server bundle's files on a placeholder that becomes the location token, never a root path", () => {
    const ssr = url("assets/logo.abc.png", context({ ssr: true }));
    expect(ssr).toBe("__DROPLETS_SERVER_LOCATION__/assets/logo.abc.png");
    expect(url("img/a.png", context({ ssr: true, type: "public" }))).toBe("__DROPLETS_SERVER_LOCATION__/assets/public/img/a.png");
  });

  it("lets the user's own renderBuiltUrl answer first", () => {
    const own = builtUrl({ user: (file) => (file.endsWith(".png") ? `https://cdn.example/${file}` : undefined) });
    expect(own("assets/logo.abc.png", context({ ssr: true }))).toBe("https://cdn.example/assets/logo.abc.png");
    expect(own("assets/font.woff2", context({}))).toEqual({ relative: true });
  });
});

describe("rewriteFileUrls", () => {
  const location = hostTokens({ nonce: "n1" }).location;

  it("imports a file new URL(…, import.meta.url) names and puts it on the location token", () => {
    const code = 'const a = new URL("./logo.png", import.meta.url).href;\nconst b = new URL("./missing.png", import.meta.url);';
    const out = rewriteFileUrls({ code, file: join(dir, "card.js"), location }) ?? expect.unreachable("a rewrite");
    expect(out).toContain('import __droplets_file_0 from "./logo.png?url";');
    expect(out).toContain(`new URL(__droplets_file_0, ${JSON.stringify(`${location}/`)}).href`);
    // Not a file: left for the code to deal with.
    expect(out).toContain('new URL("./missing.png", import.meta.url)');
    expect(out).not.toContain("file://");
  });

  it("answers null when nothing names a file", () => {
    expect(rewriteFileUrls({ code: "new URL(`./${x}`, import.meta.url)", file: join(dir, "card.js"), location })).toBeNull();
    expect(rewriteFileUrls({ code: 'new URL("https://x.example/a")', file: join(dir, "card.js"), location })).toBeNull();
  });
});

describe("assetUrlsPlugin", () => {
  const state = createInitialState();
  const plugin = assetUrlsPlugin(state);
  const hook = <T>(value: unknown) => (typeof value === "function" ? value : (value as { handler: T }).handler) as T;
  type RenderChunk = (this: unknown, code: string, chunk: { fileName: string }) => { code: string } | null;
  type Transform = (this: unknown, code: string, id: string) => { code: string } | null;
  const env = (consumer: "client" | "server") => ({ environment: { config: { consumer } } });

  it("writes the way back to the build's root in each browser bundle", () => {
    const render = hook<RenderChunk>(plugin.renderChunk);
    const code = 'new URL("__DROPLETS_BUILD_ROOT__", url)';
    expect(render.call(env("client"), code, { fileName: "droplets/pics/client.js" })?.code).toBe('new URL("../../", url)');
    expect(render.call(env("client"), code, { fileName: "assets/index.abc.js" })?.code).toBe('new URL("../", url)');
    expect(render.call(env("client"), code, { fileName: "index.js" })?.code).toBe('new URL("./", url)');
    // From a bundle at https://host.example/mfe/droplets/pics/client.js: the prefix is kept.
    expect(new URL("../../", "https://host.example/mfe/droplets/pics/client.js").href).toBe("https://host.example/mfe/");
  });

  it("writes the shared instance's location token in server bundles", () => {
    const render = hook<RenderChunk>(plugin.renderChunk);
    const out = render.call(env("server"), '"__DROPLETS_SERVER_LOCATION__/assets/a.png"', { fileName: "entry-server.js" });
    expect(out?.code).toBe(JSON.stringify(`${hostTokens({ nonce: state.tokenNonce }).location}/assets/a.png`));
  });

  it("rewrites new URL(…, import.meta.url) in universal files of a server bundle, never in server files", () => {
    const transform = hook<Transform>(plugin.transform);
    state.root = dir;
    const code = 'export const a = new URL("./logo.png", import.meta.url).href;';
    expect(transform.call(env("server"), code, join(dir, "card.js"))?.code).toContain("?url");
    expect(transform.call(env("server"), code, join(dir, "card.server.js"))).toBeNull();
    expect(transform.call(env("client"), code, join(dir, "card.js"))).toBeNull();
  });
});

describe("publicFileHandler", () => {
  const app = () => new Hono().get("/assets/public/*", publicFileHandler({ publicDir: join(dir, "public") }));

  it("serves public/ with no-cache and an ETag, 304 when it matches", async () => {
    const res = await app().request("/assets/public/img/a.png");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("png");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    const etag = res.headers.get("etag") ?? expect.unreachable("an etag");
    expect(etag).toMatch(/^"[\w-]+"$/);
    const again = await app().request("/assets/public/img/a.png", { headers: { "if-none-match": etag } });
    expect(again.status).toBe(304);
    expect(await again.text()).toBe("");
    expect((await app().request("/assets/public/img/a.png", { headers: { "if-none-match": '"other"' } })).status).toBe(200);
  });

  it("404s a missing file, a folder and a way out of public/", async () => {
    expect((await app().request("/assets/public/nope.txt")).status).toBe(404);
    expect((await app().request("/assets/public/img")).status).toBe(404);
    expect((await app().request("/assets/public/..%2Flogo.png")).status).toBe(404);
    expect((await app().request("/assets/public/%2e%2e/logo.png")).status).toBe(404);
  });
});
