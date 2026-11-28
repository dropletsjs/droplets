import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDropletsApp, type DropletsAppOptions, type RenderDroplet } from "../../src/runtime/app.ts";
import { mintFormResult } from "../../src/runtime/form-token.server.ts";
import type { Action } from "../../src/runtime/server.ts";

// Every decoder export, spied: none may run on the server.
const decoded = vi.hoisted(() => ({ calls: 0 }));
vi.mock("../../src/runtime/payload-decode.ts", async (original) => {
  const actual = await original<Record<string, unknown>>();
  return Object.fromEntries(
    Object.entries(actual).map(([name, value]) => [
      name,
      typeof value === "function"
        ? (...args: unknown[]) => {
            decoded.calls += 1;
            return (value as (...a: unknown[]) => unknown)(...args);
          }
        : value,
    ]),
  );
});

const ORIGIN = "http://drops.test";
const SECRET = "test-secret-0123456789abcdef-0123456789";

/** What a client might send to look like a payload: a table, and values in a transport's JSON form. */
const SHAPED = {
  at: "1970-01-01T00:00:00.000Z",
  big: "10",
  transported: [
    [["at"], "Date"],
    [["big"], "BigInt"],
    [["data", "at"], "Date"],
    [["__proto__"], "Map"],
  ],
};

type Seen = { props?: unknown; form?: unknown };

function boundaryApp(seen: Seen, overrides: Partial<DropletsAppOptions> = {}) {
  const renderDroplet: RenderDroplet = async (_name, event, options) => {
    seen.props = event.props;
    seen.form = options?.form;
    return { html: "<p>x</p>", hasLoad: false as const, serverData: { ok: true } };
  };
  const echo: Action = async ({ request }) => Object.fromEntries((await request.formData()).entries());
  return createDropletsApp({
    renderDroplet,
    getDropletMeta: (name) => ({ exists: true, ssr: true, hydrate: name !== "still" }),
    findAction: async (_droplet, name) => (name === "default" ? echo : "missing"),
    buildHash: "abc123",
    ...overrides,
  });
}

const decode = (b64: string) => JSON.parse(Buffer.from(b64, "base64").toString("utf8")) as Record<string, unknown>;
const envelopeOf = (html: string) => decode(html.match(/data-droplet-payload="data">([^<]*)</)?.[1] ?? "");

describe("the server decodes nothing a request carries", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("hands what is shaped like a payload to the load and the action as the plain data it is", async () => {
    const seen: Seen = {};
    const app = boundaryApp(seen);
    const shapedJson = JSON.stringify(SHAPED);

    // The JSON body.
    await app.request(`${ORIGIN}/droplets/hello`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ props: SHAPED }),
    });
    expect(seen.props).toEqual(SHAPED);

    // x-droplet-props.
    await app.request(`${ORIGIN}/droplets/hello`, { headers: { "x-droplet-props": Buffer.from(shapedJson).toString("base64") } });
    expect(seen.props).toEqual(SHAPED);

    // The query.
    await app.request(`${ORIGIN}/droplets/hello?at=${encodeURIComponent(SHAPED.at)}&transported=${encodeURIComponent(shapedJson)}`);
    expect(seen.props).toEqual({ at: SHAPED.at, transported: shapedJson });

    // The POSTed form of a droplet re-rendered after an enhanced form: plain, and the envelope's own table stays the server's.
    const rendered = await app.request(`${ORIGIN}/droplets/hello`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ props: {}, form: SHAPED }),
    });
    expect(seen.form).toEqual(SHAPED);
    expect(envelopeOf(await rendered.text())).toEqual({ data: { ok: true }, form: SHAPED });

    // A form field named like the table, through an action answered in JSON.
    const answered = await app.request(`${ORIGIN}/droplets/hello`, {
      method: "POST",
      headers: { origin: ORIGIN, accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ at: SHAPED.at, transported: shapedJson }).toString(),
    });
    expect(await answered.json()).toEqual({ type: "success", status: 200, data: { at: SHAPED.at, transported: shapedJson } });

    expect(decoded.calls).toBe(0);
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  it("reads a signed result as the plain JSON it is, whatever its shape", async () => {
    vi.stubEnv("DROPLETS_SECRET", SECRET);
    const seen: Seen = {};
    const app = boundaryApp(seen);
    const page = `${ORIGIN}/book`;
    const { value } = await mintFormResult({
      secret: SECRET,
      scope: { droplet: "hello", build: "abc123", page },
      result: { action: "default", status: 200, data: SHAPED },
    });
    const res = await app.request(`${ORIGIN}/droplets/hello`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ host: `${page}?__droplet_form_hello_abc123=${value}`, props: {} }),
    });
    expect(res.status).toBe(200);
    expect(seen.form).toEqual(SHAPED);
    expect(Object.getPrototypeOf(seen.form)).toBeNull();
    expect(envelopeOf(await res.text())).toEqual({ data: { ok: true }, form: SHAPED });
    expect(decoded.calls).toBe(0);
  });
});

describe("the decoder's importers", () => {
  it("are browser modules only: no server module imports payload-decode.ts", () => {
    const src = fileURLToPath(new URL("../../src/", import.meta.url));
    const files = (readdirSync(src, { recursive: true }) as string[]).filter((file) => /\.(ts|js)$/.test(file));
    const importers = files
      .filter((file) =>
        /from\s+["'][^"']*payload-decode(\.ts)?["']|import\(\s*["'][^"']*payload-decode/.test(readFileSync(join(src, file), "utf8")),
      )
      .map((file) => relative(src, join(src, file)).replaceAll("\\", "/"));
    expect(importers).toEqual(["runtime/entry-client.ts"]);
  });
});
