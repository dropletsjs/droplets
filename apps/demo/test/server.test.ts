import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";

// The built Node server (dist/server.js), driven in-process through its
// fetch handler. `pnpm build` first (the root `pnpm check` does).
const root = fileURLToPath(new URL("..", import.meta.url));
const ORIGIN = "http://localhost:8790";
const DOCS = "https://dropletsjs.dev";
const PAGE = `${DOCS}/guides/writing-droplets/`;
const RETURN = `__droplet_return=${encodeURIComponent(PAGE)}`;

let server: { fetch(request: Request): Promise<Response> };

beforeAll(async () => {
  if (!existsSync(join(root, "dist/server.js"))) throw new Error("dist/server.js is missing: run `pnpm build` first");
  Object.assign(process.env, {
    DROPLETS_SECRET: "test-demo-secret-0123456789abcdef-0123456789",
    DROPLETS_LOG: "error",
  });
  server = (await import(join(root, "dist/server.js"))).default;
});

const call = (path: string, init: RequestInit = {}) => server.fetch(new Request(`${ORIGIN}${path}`, init));

const isRecord = (value: unknown): value is Record<string, string> =>
  typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype;

/** An enhanced form's post from the docs: the docs' Origin, a form body, the JSON answer. */
const vote = (fields: Record<string, string> | BodyInit, init: RequestInit = {}, path = `/droplets/poll?/vote&${RETURN}`) =>
  call(path, {
    method: "POST",
    body: isRecord(fields) ? new URLSearchParams(fields) : fields,
    ...init,
    headers: { origin: DOCS, accept: "application/json", ...(init.headers as Record<string, string>) },
  });

/**
 * A form post whose body records whether anyone pulled it, and whether
 * anything parsed it (formData, json, text…), with a content-length as a
 * browser sends it.
 */
async function postWatched(path: string) {
  const text = "answer=vue";
  let pulled = false;
  const body = new ReadableStream(
    {
      pull(controller) {
        pulled = true;
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      },
    },
    { highWaterMark: 0 }, // pulled only when someone reads it
  );
  const parsers = (["formData", "json", "text", "arrayBuffer", "blob", "bytes"] as const)
    .filter((method) => method in Request.prototype)
    .map((method) => vi.spyOn(Request.prototype, method));
  try {
    const response = await vote(
      body,
      {
        duplex: "half",
        headers: { "content-type": "application/x-www-form-urlencoded", "content-length": String(text.length) },
      } as RequestInit,
      path,
    );
    return { response, parsed: parsers.some((spy) => spy.mock.calls.length > 0), pulled };
  } finally {
    for (const spy of parsers) spy.mockRestore();
  }
}

const payload = (html: string, name: "data" | "context") => {
  const encoded = html.match(new RegExp(`data-droplet-${name}>([^<]+)<`))?.[1];
  return encoded ? JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) : undefined;
};

describe("the droplets", () => {
  it("hello greets who, rendered on the server, and lets a cache keep it", async () => {
    const response = await call("/droplets/hello?who=Ana");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    const html = await response.text();
    expect(html.startsWith('<djs-demo data-droplet="hello"')).toBe(true);
    expect(html).toContain("Hello Ana!");
    expect(payload(html, "data").data.greeting).toBe("Hello Ana!");
    expect(await (await call("/droplets/hello")).text()).toContain("Hello world!");
  });

  it("counter renders its start on the server and has no server load", async () => {
    const html = await (await call("/droplets/counter?start=3")).text();
    expect(html).toMatch(/<output[^>]*>3<\/output>/);
    // No +droplet.server.ts: the browser fetches its bundle and nothing else.
    expect((await call("/droplets/counter/client.js")).status).toBe(200);
  });

  it("poll renders its question and an action URL back to the page", async () => {
    const response = await call("/droplets/poll", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ host: PAGE, props: {} }),
    });
    const html = await response.text();
    expect(html).toContain("Which framework would you write your next droplet in?");
    expect(html).toContain(`action="${ORIGIN}/droplets/poll?/vote&amp;${RETURN}"`);
  });

  it("crash renders normally, and its +error inside the same element when the load throws", async () => {
    const fine = await call("/droplets/crash");
    expect(fine.status).toBe(200);
    expect(await fine.text()).toContain("All fine");

    const crashed = await call("/droplets/crash?fail=1");
    expect(crashed.status).toBe(500);
    expect(crashed.headers.get("cache-control")).toBe("private, no-store");
    const html = await crashed.text();
    expect(html).toMatch(/^<djs-demo data-droplet="crash"[^>]* data-droplet-error>/);
    expect(html).toContain("This is the droplet's +error page");
    // handleError keeps the thrown message on the server.
    expect(html).not.toContain("because fail was set");
    expect(payload(html, "data")).toEqual({ error: { message: expect.stringContaining("+error page") } });

    const posted = await call("/droplets/crash", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ props: { fail: true } }),
    });
    expect(posted.status).toBe(500);
  });

  describe("the renderer pages' counters", () => {
    // One droplet per renderer, the same in each: the server load's start
    // and the framework's name, rendered on the server (but the script's).
    const COMPONENTS = [
      ["svelte", "Svelte"],
      ["vue", "Vue"],
      ["react", "React"],
      ["preact", "Preact"],
      ["solid", "Solid"],
      ["hono-jsx", "Hono JSX"],
      ["handlebars", "Handlebars"],
      ["lit", "Lit"],
    ] as const;

    for (const [id, framework] of COMPONENTS) {
      it(`counter-${id} renders its start and ${framework}'s name on the server`, async () => {
        const response = await call(`/droplets/counter-${id}`);
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("public, max-age=300");
        const html = await response.text();
        expect(html.startsWith(`<djs-demo data-droplet="counter-${id}"`)).toBe(true);
        // React and Solid put a comment between the text and the value.
        expect(html.replace(/<!--[^>]*-->/g, "")).toContain(`counter · ${framework}`);
        expect(html).toMatch(/<output[^>]*>(?:<!--[^>]*-->)*3(?:<!--[^>]*-->)*<\/output>/);
        if (id === "handlebars") {
          // hydrate = false: no payload, no button, no bundle to fetch.
          expect(html).not.toContain("data-droplet-data");
          expect(html).not.toContain("<button");
        } else {
          expect(payload(html, "data")).toEqual({ data: { framework, start: 3 } });
          expect(html).toContain("Add one");
          expect((await call(`/droplets/counter-${id}/client.js`)).status).toBe(200);
        }
      });
    }

    it("counter-lit renders into a declarative shadow root, its styles inside", async () => {
      const html = await (await call("/droplets/counter-lit")).text();
      expect(html).toMatch(/<djs-demo-counter-lit[^>]*defer-hydration[^>]*><template [^>]*shadowrootmode="open"><style>/);
    });

    it("counter-script renders nothing on the server: its data and an empty entry", async () => {
      const response = await call("/droplets/counter-script");
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('<div style="display: contents" data-droplet-entry></div>');
      expect(html).not.toContain("Add one");
      // Client only: the props ride on the element, no inline context script.
      expect(html).toMatch(/data-context="[^"]+"/);
      expect(html).not.toContain("data-droplet-context");
      expect(payload(html, "data")).toEqual({ data: { framework: "plain script", start: 3 } });
      expect((await call("/droplets/counter-script/client.js")).status).toBe(200);
    });
  });

  it("refuses props outside the schemas before any load runs", async () => {
    for (const path of [
      `/droplets/hello?who=${"x".repeat(41)}`,
      "/droplets/hello?who=",
      "/droplets/counter?start=abc",
      "/droplets/counter?start=1.5",
      "/droplets/counter?start=100000",
      "/droplets/crash?fail=maybe",
    ]) {
      expect((await call(path)).status, path).toBe(400);
    }
  });
});

describe("the poll's action", () => {
  it("echoes a valid vote", async () => {
    const response = await vote({ answer: "vue" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ type: "success", status: 200, data: { voted: "vue", label: "Vue" } });
  });

  it("answers fail() for a missing, empty or unknown answer, with a code and never the value", async () => {
    for (const [fields, code] of [
      [{}, "missing"],
      [{ answer: "" }, "missing"],
      [{ answer: "   " }, "missing"],
      [{ answer: "angular" }, "unknown"],
      [{ answer: "VUE" }, "unknown"],
    ] as const) {
      const response = await vote(fields);
      expect(response.status, JSON.stringify(fields)).toBe(422);
      expect(await response.json()).toEqual({ type: "failure", status: 422, data: { field: "answer", code } });
    }
  });

  it("is stateless: no cookie, nothing remembered between visitors", async () => {
    const first = await vote({ answer: "svelte" });
    const second = await vote({ answer: "react" });
    expect(first.headers.get("set-cookie")).toBeNull();
    expect(second.headers.get("set-cookie")).toBeNull();
    expect((await second.json()).data).toEqual({ voted: "react", label: "React" });
    // The render after it knows nothing of either vote.
    const html = await (await call("/droplets/poll")).text();
    expect(html).not.toContain("You picked");
  });

  it("answers a native post with Post/Redirect/Get back to the docs page", async () => {
    const response = await call(`/droplets/poll?/vote&${RETURN}`, {
      method: "POST",
      body: new URLSearchParams({ answer: "solid" }),
      headers: { origin: DOCS },
    });
    expect(response.status).toBe(303);
    const location = new URL(response.headers.get("location")!);
    expect(`${location.origin}${location.pathname}`).toBe(PAGE);
    expect([...location.searchParams.keys()]).toEqual([expect.stringMatching(/^__droplet_form_poll_[0-9a-f]{6}$/)]);
  });

  describe("plain data only", () => {
    it("looks answers up in a Map: prototype names are unknown answers", async () => {
      for (const answer of ["__proto__", "toString", "valueOf"]) {
        const response = await vote({ answer });
        expect(response.status, answer).toBe(422);
        expect((await response.json()).data, answer).toEqual({ field: "answer", code: "unknown" });
      }
      // Longer than any id: not even looked up.
      for (const answer of ["constructor", "hasOwnProperty"]) {
        const response = await vote({ answer });
        expect((await response.json()).data, answer).toEqual({ field: "answer", code: "missing" });
      }
    });

    it("reads only strings: a file where the answer goes is a missing answer", async () => {
      const form = new FormData();
      form.append("answer", new File(["vue"], "vue.txt", { type: "text/plain" }));
      const response = await vote(form);
      expect(response.status).toBe(422);
      expect((await response.json()).data).toEqual({ field: "answer", code: "missing" });
    });

    it("merges nothing from the body: prototype keys stay data", async () => {
      const body = "answer=vue&__proto__[polluted]=1&constructor[prototype][polluted]=1&__proto__.polluted=1";
      const response = await vote(body, { headers: { "content-type": "application/x-www-form-urlencoded" } });
      expect(response.status).toBe(200);
      expect((await response.json()).data).toEqual({ voted: "vue", label: "Vue" });
      expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
      expect(Object.prototype).not.toHaveProperty("polluted");
    });

    it("reads an answer longer than any id as no answer", async () => {
      const response = await vote({ answer: "vue-x" });
      expect((await response.json()).data).toEqual({ field: "answer", code: "unknown" });
      const long = await vote({ answer: "x".repeat(200) });
      expect((await long.json()).data).toEqual({ field: "answer", code: "missing" });
    });

    it("never answers a JSON body as an action", async () => {
      const response = await vote(JSON.stringify({ answer: "vue" }), { headers: { "content-type": "application/json" } });
      expect(response.status).toBe(400);
    });
  });

  describe("the code is resolved before the body is read", () => {
    it("parses the body of the action it resolved (the control)", async () => {
      const { response, parsed } = await postWatched(`/droplets/poll?/vote&${RETURN}`);
      expect(response.status).toBe(200);
      expect(parsed).toBe(true);
    });

    it("answers 404 for an action that is not an own function, the body never read", async () => {
      for (const name of ["__proto__", "constructor", "toString", "hasOwnProperty", "nope", "vote.x"]) {
        const { response, parsed, pulled } = await postWatched(`/droplets/poll?/${name}&${RETURN}`);
        expect(response.status, name).toBe(404);
        expect(parsed, name).toBe(false);
        expect(pulled, name).toBe(false);
      }
    });

    it("answers 405 for a droplet without actions, the body never read", async () => {
      for (const id of ["hello", "counter", "crash", "counter-svelte", "counter-lit", "counter-script"]) {
        const { response, parsed, pulled } = await postWatched(`/droplets/${id}?/vote&${RETURN}`);
        expect(response.status, id).toBe(405);
        expect(parsed, id).toBe(false);
        expect(pulled, id).toBe(false);
      }
    });

    it("answers 404 for droplets that are not in the manifest, prototype names included", async () => {
      for (const id of ["__proto__", "constructor", "toString", "nope"]) {
        const { response, parsed, pulled } = await postWatched(`/droplets/${id}?/vote`);
        expect(response.status, id).toBe(404);
        expect(parsed, id).toBe(false);
        expect(pulled, id).toBe(false);
        expect((await call(`/droplets/${id}`)).status, id).toBe(404);
      }
    });

    it("answers 400 for two action names", async () => {
      const response = await vote({ answer: "vue" }, {}, `/droplets/poll?/vote&/vote&${RETURN}`);
      expect(response.status).toBe(400);
    });
  });

  describe("size limits", () => {
    it("answers 413 for a form body over 4 KB, by content-length or streamed", async () => {
      expect((await vote({ answer: "vue", pad: "x".repeat(5000) })).status).toBe(413);
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`answer=vue&pad=${"x".repeat(5000)}`));
          controller.close();
        },
      });
      const streamed = await vote(stream, {
        duplex: "half",
        headers: { "content-type": "application/x-www-form-urlencoded" },
      } as RequestInit);
      expect(streamed.status).toBe(413);
    });

    it("answers 413 for a multipart body over 8 KB", async () => {
      const form = new FormData();
      form.append("answer", "vue");
      form.append("pad", "x".repeat(9000));
      expect((await vote(form)).status).toBe(413);
    });

    it("answers 413 for a JSON render over 16 KB, and 431 for props headers over 1 KB", async () => {
      const big = await call("/droplets/hello", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ props: { who: "x".repeat(20_000) } }),
      });
      expect(big.status).toBe(413);
      const header = Buffer.from(JSON.stringify({ who: "x".repeat(2000) })).toString("base64");
      expect((await call("/droplets/hello", { headers: { "x-droplet-props": header } })).status).toBe(431);
    });
  });

  describe("who may post", () => {
    it("refuses a form post from any origin but the docs', or without one", async () => {
      for (const origin of ["https://evil.example", "https://dropletsjs.dev.evil.example", "null", "http://localhost:9999"]) {
        const response = await vote({ answer: "vue" }, { headers: { origin } });
        expect(response.status, origin).toBe(403);
      }
      const response = await call(`/droplets/poll?/vote&${RETURN}`, {
        method: "POST",
        body: new URLSearchParams({ answer: "vue" }),
        headers: { accept: "application/json" },
      });
      expect(response.status).toBe(403);
    });

    it("never sends a native post back to a page outside the trusted origins", async () => {
      const response = await call(`/droplets/poll?/vote&__droplet_return=${encodeURIComponent("https://evil.example/")}`, {
        method: "POST",
        body: new URLSearchParams({ answer: "vue" }),
        headers: { origin: DOCS },
      });
      expect(response.status).toBe(400);
    });
  });
});

describe("CORS", () => {
  it("answers the docs' origins, and only them", async () => {
    for (const origin of [DOCS, "http://localhost:4321", "http://127.0.0.1:4321"]) {
      const response = await call("/index.js", { headers: { origin } });
      expect(response.headers.get("access-control-allow-origin"), origin).toBe(origin);
    }
    for (const origin of ["https://evil.example", "https://dropletsjs.dev.evil.example", "http://localhost:4322", "null"]) {
      const response = await call("/index.js", { headers: { origin } });
      expect(response.headers.get("access-control-allow-origin"), origin).toBeNull();
      const preflight = await call("/droplets/poll/_data", {
        method: "OPTIONS",
        headers: { origin, "access-control-request-method": "POST", "access-control-request-headers": "content-type" },
      });
      expect(preflight.headers.get("access-control-allow-origin"), origin).toBeNull();
    }
  });

  it("keeps a preflight for a day", async () => {
    const preflight = await call("/droplets/poll/_data", {
      method: "OPTIONS",
      headers: { origin: DOCS, "access-control-request-method": "POST", "access-control-request-headers": "content-type" },
    });
    expect(preflight.headers.get("access-control-max-age")).toBe("86400");
  });
});

describe("the droplet location", () => {
  it("ignores a location header unless trusted: a fragment's URLs stay on the server's own origin", async () => {
    for (const headers of <Record<string, string>[]>[
      { "x-droplet-location": "https://evil.example" },
      { "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" },
      { forwarded: "proto=https;host=evil.example" },
    ]) {
      const html = await (await call("/droplets/hello", { headers })).text();
      expect(html).not.toContain("evil.example");
      expect(html).toContain(`${ORIGIN}/droplets/hello/style.css`);
    }
  });
});

describe("server-only code", () => {
  it("never reaches a client bundle", async () => {
    const client = join(root, "dist/client");
    const files = (await readdir(client, { recursive: true })).filter((file) => /\.(js|css|html)$/.test(file));
    expect(files.length).toBeGreaterThan(5);
    // Strings that live only in *.server.* files and under src/lib/server/.
    const markers = [
      "Which framework would you write your next droplet in?", // lib/poll.ts, imported by +droplet.server.ts only
      "because fail was set", // crash/+droplet.server.ts
      "This is the droplet's +error page", // crash's handleError
      "public, max-age=300", // the loads' setHeaders
    ];
    for (const file of files) {
      const source = await readFile(join(client, file), "utf8");
      for (const marker of markers) expect(source.includes(marker), `${marker} in ${file}`).toBe(false);
    }
  });
});
