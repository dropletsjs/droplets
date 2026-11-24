/**
 * An entry's `host` at build passes the bound a request's host passes at
 * runtime: `host` of `droplets.config.ts` when it is set, else
 * `trustedOrigins` with `DROPLETS_TRUSTED_ORIGINS` when that list is set.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createBuilder } from "vite";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { fakeRenderer } from "../../src/testing/index.ts";
import { droplets, type DropletsAdapter } from "../../src/vite.ts";

const fixtures = fileURLToPath(new URL("../fixtures/", import.meta.url));

const fakeAdapter: DropletsAdapter = {
  name: "fake",
  serverEntry: resolve(fixtures, "app/fake-entry.js"),
  serverFile: "server.js",
  separateSsrBundle: true,
};

const roots: string[] = [];
afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});
afterEach(() => {
  vi.unstubAllEnvs();
});

type ProjectInput = { entries: ReadonlyArray<{ props: Record<string, unknown>; host?: string }>; config: string };

/** A project with one prerendered droplet, `testimonials`, listing `entries` under `config`. */
async function project({ entries, config }: ProjectInput): Promise<string> {
  const root = await mkdtemp(join(fixtures, ".prerender-entry-host-"));
  roots.push(root);
  const folder = join(root, "src/droplets/testimonials");
  await mkdir(folder, { recursive: true });
  await writeFile(
    join(folder, "+droplet.fake.js"),
    "export const prerender = true;\n\nexport default ({ data }) => `<p>${data.origin}</p>`;\n",
  );
  await writeFile(
    join(folder, "+droplet.server.ts"),
    `export const load = ({ host }) => ({ origin: host.origin });\nexport const entries = () => ${JSON.stringify(entries)};\n`,
  );
  await writeFile(join(root, "droplets.config.ts"), `export default ${config};\n`);
  return root;
}

type BuildInput = { root: string };

function build({ root }: BuildInput): Promise<unknown> {
  return createBuilder({
    root,
    configFile: false,
    logLevel: "silent",
    plugins: [droplets({ adapter: fakeAdapter, renderers: [fakeRenderer()] })],
  }).then((builder) => builder.buildApp());
}

/** The keys of the stored renders. */
async function storedKeys({ root }: BuildInput): Promise<string[]> {
  const file = join(root, "dist/server/_prerendered/testimonials/index.json");
  const index = JSON.parse(await readFile(file, "utf8")) as Record<string, string>;
  return Object.keys(index).sort();
}

describe("an entry's host at build, with host fixed", () => {
  it("fails the build for an entry on another origin, naming both", async () => {
    const root = await project({
      entries: [{ props: { page: 2 }, host: "https://abc.example/blog" }],
      config: '{ host: "https://shop.example" }',
    });
    await expect(build({ root })).rejects.toThrow(
      `droplets error prerender-host-outside-host\n  droplet: testimonials\n  what: the entry {"page":2} names host https://abc.example/blog, outside host in droplets.config.ts (https://shop.example)\n  fix: drop the entry's host or change it to that origin`,
    );
  }, 90_000);

  it("renders an entry on that origin, any page of it", async () => {
    const root = await project({
      entries: [{ props: { page: 2 }, host: "https://shop.example/blog" }, { props: { page: 3 } }],
      config: '{ host: "https://shop.example", trustedOrigins: ["https://other.example"] }',
    });
    await build({ root });
    expect(await storedKeys({ root })).toEqual(['{"page":2} https://shop.example/blog', '{"page":3} https://shop.example']);
  }, 90_000);
});

describe("an entry's host at build, with trustedOrigins", () => {
  it("fails the build for an entry outside the list, naming both", async () => {
    const root = await project({
      entries: [{ props: { page: 1 } }, { props: { page: 2 }, host: "https://abc.example/blog" }],
      config: '{ trustedOrigins: ["https://shop.example"] }',
    });
    await expect(build({ root })).rejects.toThrow(
      `droplets error prerender-host-untrusted\n  droplet: testimonials\n  what: the entry {"page":2} names host https://abc.example/blog, outside trustedOrigins in droplets.config.ts (https://shop.example)\n  fix: add the origin there or drop the entry's host`,
    );
  }, 90_000);

  it("renders an entry on a listed origin, or on the origin of location, this server's own", async () => {
    const root = await project({
      entries: [
        { props: { page: 1 }, host: "https://shop.example/blog" },
        { props: { page: 2 }, host: "https://cdn.example/a" },
      ],
      config: '{ location: "https://cdn.example/mfe", trustedOrigins: ["https://shop.example"] }',
    });
    await build({ root });
    expect(await storedKeys({ root })).toEqual(['{"page":1} https://shop.example/blog', '{"page":2} https://cdn.example/a']);
  }, 90_000);

  it('renders any entry with "*"', async () => {
    const root = await project({
      entries: [{ props: { page: 1 }, host: "https://abc.example/blog" }],
      config: '{ trustedOrigins: ["*"] }',
    });
    await build({ root });
    expect(await storedKeys({ root })).toEqual(['{"page":1} https://abc.example/blog']);
  }, 90_000);

  it("counts DROPLETS_TRUSTED_ORIGINS from the build's environment", async () => {
    vi.stubEnv("DROPLETS_TRUSTED_ORIGINS", "https://blog.example, not an origin");
    const root = await project({
      entries: [{ props: { page: 1 }, host: "https://blog.example/a" }],
      config: '{ trustedOrigins: ["https://shop.example"] }',
    });
    await build({ root });
    expect(await storedKeys({ root })).toEqual(['{"page":1} https://blog.example/a']);
  }, 90_000);

  it("names DROPLETS_TRUSTED_ORIGINS too when it set the list, and cuts long values short", async () => {
    vi.stubEnv("DROPLETS_TRUSTED_ORIGINS", "https://a.example,https://b.example,https://c.example,https://d.example,https://e.example");
    const root = await project({
      entries: [{ props: { text: "x".repeat(100) }, host: "https://abc.example/blog" }],
      config: '{ trustedOrigins: ["https://shop.example"] }',
    });
    await expect(build({ root })).rejects.toThrow(
      `  what: the entry {"text":"${"x".repeat(70)}… names host https://abc.example/blog, outside trustedOrigins in droplets.config.ts and DROPLETS_TRUSTED_ORIGINS (https://shop.example, https://a.example, https://b.example, https://c.example, https://d.example and 1 more)\n  fix: add the origin there or drop the entry's host`,
    );
  }, 90_000);
});

describe("an entry's host at build, with no list", () => {
  it("renders an entry on any origin", async () => {
    const root = await project({ entries: [{ props: { page: 1 }, host: "https://abc.example/blog" }], config: "{}" });
    await build({ root });
    expect(await storedKeys({ root })).toEqual(['{"page":1} https://abc.example/blog']);
  }, 90_000);
});
