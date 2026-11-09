import { expect, test, type Locator, type Page } from "@playwright/test";
import { dropletsPort } from "./examples.ts";

const SECRET = "e2e-secret-value";
const MODES = ["client", "ssr-hydrate", "ssr-nohydrate"] as const;

/** The example this project runs: its name (playwright.config.ts). */
const exampleOf = () => test.info().project.name;
const dropletsOf = (example: string) => `http://localhost:${dropletsPort(example)}`;
/** Handlebars templates have no client behaviour: no button, nothing hydrates. */
const interactive = (example: string) => example !== "handlebars";

type Watch = { errors: string[]; requests: string[]; bodies: string[] };

/** Opens a host page, collecting page errors, every request and every script the browser got. */
async function open(page: Page, path: string): Promise<Watch> {
  const watch: Watch = { errors: [], requests: [], bodies: [] };
  page.on("pageerror", (error) => watch.errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") watch.errors.push(message.text());
  });
  page.on("request", (request) => watch.requests.push(request.url()));
  page.on("response", async (response) => {
    if (/javascript|json|html/.test(response.headers()["content-type"] ?? "")) {
      watch.bodies.push(await response.text().catch(() => ""));
    }
  });
  await page.goto(path);
  return watch;
}

const card = (page: Page, mode: string): Locator => page.locator(`[data-testid="card"][data-mode="${mode}"]`);

const countOf = async (locator: Locator) => Number(await locator.getByTestId("count").textContent());

// React and Solid put hydration markers between text nodes.
const textOf = async (response: { text(): Promise<string> }) => (await response.text()).replace(/<!--[^>]*-->/g, "");

test.describe("every droplet, embedded from another origin", () => {
  test("renders all three, with each kind of variable where it belongs", async ({ page }) => {
    const example = exampleOf();
    const watch = await open(page, "");
    for (const mode of MODES) {
      const it = card(page, mode);
      await expect(it, mode).toBeVisible();
      await expect(it).toHaveAttribute("data-framework", example);
      // Public, inlined at build.
      await expect(it.getByTestId("site")).toHaveText("Droplets showcase");
      // Public, read at runtime: the server's environment, not the build's.
      await expect(it.getByTestId("banner")).toHaveText("from the e2e run");
      // Private: only what it tells, from the server load or /api/env.
      await expect(it.getByTestId("private")).toHaveText("set, channel example");
    }
    await page.waitForLoadState("networkidle");
    expect(watch.bodies.join("\n")).not.toContain(SECRET);
    expect(await page.content()).not.toContain(SECRET);
    expect(watch.errors).toEqual([]);
  });

  test("hydrates what hydrates, and ships no JavaScript for the rest", async ({ page }) => {
    const example = exampleOf();
    const droplets = dropletsOf(example);
    const watch = await open(page, "");
    if (interactive(example)) {
      await expect(card(page, "client").getByTestId("hydrated")).toHaveText("yes");
      await expect(card(page, "ssr-hydrate").getByTestId("hydrated")).toHaveText("yes");
      await expect(card(page, "ssr-hydrate").getByTestId("rendered")).toContainText("on the server");
      await expect(card(page, "client").getByTestId("rendered")).toHaveText("in the browser");
      // A client droplet asks the server's API: /api/time through droplet.url().
      await expect(card(page, "client").getByTestId("time")).toHaveText(/^\d{4}-\d\d-\d\dT/);
    } else {
      // Handlebars renders in the browser too, from _data, without client behaviour.
      await expect(card(page, "client").getByTestId("rendered")).toHaveText("in the browser, data from _data");
    }
    await page.waitForLoadState("networkidle");
    await expect(card(page, "ssr-nohydrate").getByTestId("hydrated")).not.toHaveText("yes");
    expect(watch.requests.filter((url) => url.includes("/droplets/ssr-nohydrate/client.js"))).toEqual([]);
    if (interactive(example)) {
      // Every API call went to the droplets server, never to the host page's origin.
      expect(watch.requests.filter((url) => url.includes("/api/"))).not.toEqual([]);
      expect(watch.requests.filter((url) => url.includes("/api/") && !url.startsWith(`${droplets}/api/`))).toEqual([]);
    }
    expect(watch.errors).toEqual([]);
  });

  test("reacts to clicks: the interactive droplets bump the shared counter through /api", async ({ page }) => {
    const example = exampleOf();
    const droplets = dropletsOf(example);
    const watch = await open(page, "");
    if (interactive(example)) {
      for (const mode of ["client", "ssr-hydrate"] as const) {
        const it = card(page, mode);
        await expect(it.getByTestId("hydrated")).toHaveText("yes");
        await expect(it.getByTestId("count")).toHaveText(/^\d+$/);
        const before = await countOf(it);
        const answer = page.waitForResponse((r) => r.url() === `${droplets}/api/counter` && r.request().method() === "POST");
        await it.getByTestId("bump").click();
        const { count } = (await (await answer).json()) as { count: number };
        expect(count, mode).toBeGreaterThan(before);
        await expect(it.getByTestId("count")).toHaveText(String(count));
      }
    } else {
      await expect(card(page, "ssr-hydrate").getByTestId("bump")).toHaveCount(0);
    }
    await expect(card(page, "ssr-nohydrate").getByTestId("bump")).toHaveCount(0);
    expect(watch.errors).toEqual([]);
  });

  test("server loads see the counter the browser bumped", async ({ page }) => {
    const droplets = dropletsOf(exampleOf());
    const bumped = (await (await page.request.post(`${droplets}/api/counter`, { data: { by: 5 } })).json()) as {
      count: number;
    };
    await open(page, "");
    expect(await countOf(card(page, "ssr-nohydrate"))).toBeGreaterThanOrEqual(bumped.count);
  });
});

test("the props schema runs before every server load", async ({ request }) => {
  const example = exampleOf();
  const droplets = dropletsOf(example);
  // lib/props.ts trims `who` and defaults it.
  expect(await textOf(await request.get(`${droplets}/droplets/ssr-nohydrate?who=%20%20Ana%20%20`))).toContain("Hello Ana!");
  expect(await textOf(await request.get(`${droplets}/droplets/ssr-hydrate`))).toContain("Hello world!");
  // A POST body can carry any JSON; a number is refused before the load runs.
  const refused = await request.post(`${droplets}/droplets/ssr-hydrate`, { data: { props: { who: 42 } } });
  expect(refused.status()).toBe(400);
  // A droplet rendered in the browser gets its server data through _data: checked there too.
  if (!interactive(example)) {
    const data = await request.get(`${droplets}/droplets/client/_data?who=%20Bo%20`);
    expect(((await data.json()) as { data: { who: string } }).data.who).toBe("Bo");
  }
});

test("a load that throws renders the droplet's error page, and error() answers as an endpoint", async ({ request }) => {
  const droplets = dropletsOf(exampleOf());
  // handleError in +droplet.server.ts decides what +error.* shows; the thrown message stays on the server.
  const crashed = await request.get(`${droplets}/droplets/ssr-hydrate?who=crash`);
  expect(crashed.status()).toBe(500);
  const body = await textOf(crashed);
  expect(body).toContain("Something went wrong loading this droplet.");
  expect(body).not.toContain("Asked to crash.");
  // error(404, …) in the load: a plain 404 with its message.
  const missing = await request.get(`${droplets}/droplets/ssr-hydrate?who=${"x".repeat(50)}`);
  expect(missing.status()).toBe(404);
  expect(await missing.text()).toContain("Nobody with a name that long lives here.");
});

test("an endpoint with a route param answers JSON, and its hook ran", async ({ request }) => {
  const response = await request.get(`${dropletsOf(exampleOf())}/api/greet/Ana`);
  expect(response.ok()).toBe(true);
  // hooks.server.ts sets x-request-id and puts the same id in event.locals.
  const body = (await response.json()) as { greeting: string; requestId: string };
  expect(body.greeting).toBe("Hello Ana!");
  expect(body.requestId).toBe(response.headers()["x-request-id"]);
});

test.describe("a script droplet: +droplet.script.ts, a page-view tracker", () => {
  test.skip(() => exampleOf() !== "svelte", "only the Svelte example has one");

  test("its fragment is the element, its data and nothing that runs", async ({ request }) => {
    const response = await request.get(`${dropletsOf(exampleOf())}/droplets/page-views?page=pricing`);
    expect(response.ok()).toBe(true);
    const html = await response.text();
    expect(html).toContain('<div style="display: contents" data-app-entry></div>');
    // CSP-clean: every script in it is a payload.
    expect(html.match(/<script\b[^>]*>/g)).toEqual([
      '<script type="application/text" data-app-context>',
      '<script type="application/text" data-app-data>',
    ]);
    const data = html.match(/data-app-data>([^<]+)</)?.[1] ?? "";
    expect(JSON.parse(Buffer.from(data, "base64").toString())).toEqual({ data: { page: "pricing", views: expect.any(Number) } });
    // The props schema runs before the load, as for any droplet.
    expect((await request.get(`${dropletsOf(exampleOf())}/droplets/page-views?page=..%2Fetc`)).status()).toBe(400);
  });

  test("runs in each element with the load's data, and counts each view through the example's API", async ({ page }) => {
    const droplets = dropletsOf(exampleOf());
    const before = (await (await page.request.get(`${droplets}/api/page-views?page=pricing`)).json()) as { views: number };
    const watch = await open(page, "script");
    const trackers = page.locator('djs-svelte[data-droplet="page-views"]');
    await expect(trackers).toHaveCount(2);
    for (const tracker of await trackers.all()) {
      // One line per element, in its own content root.
      const line = tracker.locator(":scope > [data-app-entry] > [data-testid='page-views']");
      await expect(line).toHaveCount(1);
      await expect(line).toHaveAttribute("data-tracked", "yes");
      await expect(line).toHaveText(/^pricing: \d+ views$/);
    }
    const after = (await (await page.request.get(`${droplets}/api/page-views?page=pricing`)).json()) as { views: number };
    expect(after.views).toBe(before.views + 2);
    // Both posts went to the droplets server, never to the host page.
    const posts = watch.requests.filter((url) => url.endsWith("/api/page-views"));
    expect(posts.length).toBeGreaterThanOrEqual(2);
    expect(posts.filter((url) => url !== `${droplets}/api/page-views`)).toEqual([]);
    expect(watch.errors).toEqual([]);
  });

  test("the API takes plain data only", async ({ request }) => {
    const url = `${dropletsOf(exampleOf())}/api/page-views`;
    const post = (data: string, type = "application/json") => request.post(url, { data, headers: { "content-type": type } });
    expect((await post('{"page":"pricing"}')).status()).toBe(200);
    for (const body of ['["pricing"]', '{"__proto__":{"page":"pricing"}}', '{"page":"../etc"}', '{"page":1}', "nope", `{"page":"${"a".repeat(300)}"}`]) {
      expect((await post(body)).status(), body).toBeGreaterThanOrEqual(400);
    }
    // A form-like content type: the framework's origin check refuses it before the handler would (415).
    expect([403, 415]).toContain((await post('{"page":"pricing"}', "text/plain")).status());
  });
});

test("a droplet the host writes itself mounts in the browser, data and all", async ({ page }) => {
  const watch = await open(page, "written");
  const it = card(page, "ssr-hydrate");
  await expect(it).toBeVisible();
  await expect(it.locator(".card-greeting")).toHaveText("Hello Writer!");
  await expect(it.getByTestId("banner")).toHaveText("from the e2e run");
  if (interactive(exampleOf())) await expect(it.getByTestId("hydrated")).toHaveText("yes");
  expect(watch.errors).toEqual([]);
});
