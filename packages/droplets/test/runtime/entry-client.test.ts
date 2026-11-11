// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const encode = (value: unknown) =>
  Buffer.from(JSON.stringify(value), "utf8").toString("base64");

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

type EntryClient = typeof import("../../src/runtime/entry-client.ts");
let mod: EntryClient;
let realImport: EntryClient["DjsDropletElement"]["importModule"];

const SERVERS = Symbol.for("droplets.servers");
const servers = globalThis as unknown as Record<symbol, Record<string, { origin?: string }> | undefined>;

/** What `/index.js` writes before the entry runs: the server's location, from its own URL. */
function loadedFrom(location: string) {
  servers[SERVERS] = { "djs-droplet:test01": { origin: location } };
}

beforeAll(async () => {
  loadedFrom("http://drops.test");
  // Importing registers <djs-droplet>. The registry stub: hello hydrates and
  // has a server load, plain hydrates without one, clock does not hydrate;
  // the error pages of hello and plain hydrate, clock's does not.
  mod = await import("../../src/runtime/entry-client.ts");
  realImport = mod.DjsDropletElement.importModule;
});

beforeEach(() => {
  loadedFrom("http://drops.test");
});

afterEach(() => {
  document.body.replaceChildren();
  mod.DjsDropletElement.importModule = realImport;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

type LoadEvent = { host: URL; props: Record<string, unknown>; data: unknown };

/**
 * A droplet's browser entry, standing in for `/droplets/<id>/client.js`:
 * `load` passes the event through, so tests can read what it received from
 * what `default` mounted.
 */
function fakeModule(overrides: Record<string, unknown> = {}) {
  const fake = {
    default: vi.fn((_target: HTMLElement, _data: unknown, _host?: unknown, _info?: unknown): unknown => ({})),
    load: vi.fn(async (event: LoadEvent) => event as unknown),
    handleError: vi.fn(async (error: unknown) => error),
    renderError: vi.fn((_target: HTMLElement, _error: unknown, _host?: unknown, _info?: unknown) => ({}) as unknown),
    unmount: vi.fn(),
    validate: undefined as ReturnType<typeof vi.fn> | undefined,
    ...overrides,
  };
  // The renderer's error boundary around the component, as for one that
  // awaits its `data`: a rejection shows the error page, through
  // `renderError`'s stand-in; nothing when the handler rejects.
  const render = fake.default;
  fake.default = vi.fn((target: HTMLElement, data: unknown, host?: unknown, info?: unknown) => {
    const handle = (info as { handleError?: (error: unknown) => Promise<unknown> } | undefined)?.handleError;
    if (data instanceof Promise && handle) {
      data.catch(async (error: unknown) => {
        const shown = await handle(error).then((value) => ({ value }), () => null);
        if (shown) fake.renderError(target, shown.value, host, info);
      });
    }
    return render(target, data, host, info);
  });
  mod.DjsDropletElement.importModule = vi.fn(async () => fake) as never;
  return fake;
}

/** What the `n`th render got as `data`, settled: a promise when it mounted, the value when it hydrated. */
async function dataOf(fake: { default: { mock: { calls: unknown[][] } } }, n = 0): Promise<LoadEvent> {
  return (await fake.default.mock.calls[n]?.[1]) as LoadEvent;
}

/** A `fetch` answer that arrives when the test says. */
function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((r) => (resolve = r));
  return { promise, resolve };
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers as Record<string, string>) },
  });

type Droplet = import("../../src/runtime/dev-element.ts").DevDropletElement;
/** The element class as `installDevElement` leaves it under vitest, where `import.meta.env.DEV` is true. */
const devClass = () => mod.DjsDropletElement as import("../../src/runtime/dev-element.ts").DevDropletElementClass;

function mount(html: string): Droplet {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = html;
  document.body.appendChild(wrapper);
  return wrapper.firstElementChild as Droplet;
}

describe("decodeBase64Json", () => {
  it("round-trips multi-byte characters and ignores whitespace", () => {
    const value = { who: "Șorin ✓", n: 1 };
    const encoded = encode(value);
    const spaced = `${encoded.slice(0, 4)}\n  ${encoded.slice(4)}`;
    expect(mod.decodeBase64Json(spaced)).toEqual(value);
  });

  it("throws on garbage", () => {
    expect(() => mod.decodeBase64Json("!!")).toThrow();
  });
});

describe("<djs-droplet>", () => {
  it("is registered once", () => {
    expect(customElements.get("djs-droplet")).toBe(mod.DjsDropletElement);
  });

  it("leaves unknown droplets alone", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const el = mount(
      '<djs-droplet data-droplet="nope"><p>ssr</p></djs-droplet>',
    );
    await tick();
    expect(el.innerHTML).toBe("<p>ssr</p>");
    expect(el.querySelector("[data-droplet-entry]")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(document.head.querySelector('link[href*="drops.test"]')).toBeNull();
  });

  it("puts nothing in <head>", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    mount(
      '<djs-droplet data-droplet="clock"><div data-droplet-entry><p>1</p></div></djs-droplet>',
    );
    mount(
      '<djs-droplet data-droplet="clock"><div data-droplet-entry><p>2</p></div></djs-droplet>',
    );
    await tick();

    expect(document.head.querySelectorAll("link")).toHaveLength(0);
    // clock does not hydrate: no client module, no data fetch.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("1");
    expect(document.body.textContent).toContain("2");
  });

  it("loads from where /index.js came from, whatever the markup says", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ data: {} })));
    loadedFrom("https://shop.test/mfe");
    fakeModule();
    // A host, or a fragment someone tampered with, cannot point the element elsewhere.
    mount('<djs-droplet data-droplet="plain" data-droplet-location="data:text/javascript,alert(1)//"></djs-droplet>');
    await tick();
    expect(mod.DjsDropletElement.importModule).toHaveBeenCalledWith("https://shop.test/mfe/droplets/plain/client.js?c=test01");
  });

  it("falls back to the root of the build its bundle came from, never the page's origin, when /index.js recorded nothing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ data: {} })));
    delete servers[SERVERS];
    fakeModule();
    mount('<djs-droplet data-droplet="plain"></djs-droplet>');
    await tick();
    // Unbuilt here: the build writes the way from the bundle back to its root in place of the marker.
    expect(mod.DjsDropletElement.importModule).toHaveBeenCalledWith(
      expect.stringMatching(/^file:\/\/\/.+\/src\/runtime\/__DROPLETS_BUILD_ROOT__\/droplets\/plain\/client\.js\?c=test01$/),
    );
    expect(mod.DjsDropletElement.importModule).not.toHaveBeenCalledWith(`${location.origin}/droplets/plain/client.js?c=test01`);
  });

  it("fetches _data with the attribute context when nothing is inlined", async () => {
    const fetchSpy = vi.fn(async () => json({ data: { who: "Remote" } }));
    vi.stubGlobal("fetch", fetchSpy);
    const fake = fakeModule();

    const context = { host: "https://host.test/page", props: { who: "Remote" } };
    mount(
      `<djs-droplet data-droplet="hello" data-context="${encode(context)}"></djs-droplet>`,
    );
    await tick();
    await tick();

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/^http:\/\/drops\.test\/droplets\/hello\/_data\?/);
    expect(url).toContain("__cb=");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual(context);

    // The context goes back as it came; the browser's load runs on the page.
    const event = (await dataOf(fake));
    expect(event?.host.href).toBe(globalThis.location.href);
    expect(event?.props).toEqual({ who: "Remote" });
    expect(event?.data).toEqual({ who: "Remote" });
  });

  it("never forwards the page's query string to _data: a page's ?code= is not a prop", async () => {
    const fetchSpy = vi.fn(async () => json({ data: {} }));
    vi.stubGlobal("fetch", fetchSpy);
    const page = globalThis.location.href;
    history.replaceState(null, "", "/checkout?code=secret&who=Eve#top");
    try {
      const fake = fakeModule();
      mount(`<djs-droplet data-droplet="hello" data-params='{"who":"Ana"}'></djs-droplet>`);
      await tick();
      await tick();
      const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
      const sent = new URL(url);
      expect([...sent.searchParams.keys()]).toEqual(["__cb"]);
      expect(url).not.toContain("secret");
      const body = JSON.parse(String(init.body)) as { host: string; props: unknown };
      expect(body.props).toEqual({ who: "Ana" });
      // `host` is the page: path and query, never the fragment.
      expect(body.host).toBe(`${location.origin}/checkout?code=secret&who=Eve`);
      const event = await dataOf(fake);
      expect(event?.props).toEqual({ who: "Ana" });
      expect(event?.host.hash).toBe("");
    } finally {
      history.replaceState(null, "", page);
    }
  });

  it("mounts with the form _data answers when the page carries a no-JavaScript result, and hides it from load", async () => {
    const fetchSpy = vi.fn(async () => json({ data: { who: "Ana" }, form: { message: "Thanks" } }));
    vi.stubGlobal("fetch", fetchSpy);
    const page = globalThis.location.href;
    history.replaceState(null, "", "/book?q=1&__droplet_form_hello_test01=abc.def");
    try {
      const fake = fakeModule();
      mount(`<djs-droplet data-droplet="hello" data-params='{"who":"Ana"}'></djs-droplet>`);
      await tick();
      await tick();
      // The server gets the page as it is, result and all: it verifies it.
      const body = JSON.parse(String((fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1].body)) as { host: string };
      expect(body.host).toBe(`${location.origin}/book?q=1&__droplet_form_hello_test01=abc.def`);
      // Mounted once, with form and the data settled; load never sees the key.
      expect(fake.default).toHaveBeenCalledOnce();
      const info = fake.default.mock.calls[0]![3] as { form?: unknown };
      expect(info.form).toEqual({ message: "Thanks" });
      const event = await dataOf(fake);
      expect(event.host.href).toBe(`${location.origin}/book?q=1`);
      expect(event.data).toEqual({ who: "Ana" });
    } finally {
      history.replaceState(null, "", page);
    }
  });

  it("sends the page's result with a server-fetched context that has none", async () => {
    const fetchSpy = vi.fn(async () => json({ data: {}, form: { message: "Thanks" } }));
    vi.stubGlobal("fetch", fetchSpy);
    const page = globalThis.location.href;
    history.replaceState(null, "", "/book?__droplet_form_hello_test01=abc.def&__droplet_form_other_test01=x.y");
    try {
      const fake = fakeModule();
      const context = { host: "https://host.test/book?q=1", props: {} };
      mount(`<djs-droplet data-droplet="hello" data-context="${encode(context)}"></djs-droplet>`);
      await tick();
      await tick();
      const body = JSON.parse(String((fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1].body)) as { host: string };
      // Only this droplet's key, on the host the server rendered for.
      expect(body.host).toBe("https://host.test/book?q=1&__droplet_form_hello_test01=abc.def");
      expect((fake.default.mock.calls[0]![3] as { form?: unknown }).form).toEqual({ message: "Thanks" });
    } finally {
      history.replaceState(null, "", page);
    }
  });

  it("fails loudly and leaves an empty entry when the bundle cannot load", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mod.DjsDropletElement.importModule = vi.fn(async () => {
      throw new Error("offline");
    }) as never;
    const el = mount(
      '<djs-droplet data-droplet="hello"></djs-droplet>',
    );
    await tick();
    expect(String(error.mock.calls[0]?.[0])).toContain("failed to render droplet");
    expect(el.querySelector("[data-droplet-entry]")?.childNodes.length).toBe(0);
  });

  it("does not call _data for a droplet without a server load", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const fake = fakeModule();
    mount(
      `<djs-droplet data-droplet="plain" data-context="${encode({ host: "https://host.test", props: { n: 1 } })}"></djs-droplet>`,
    );
    await tick();
    expect(fetchSpy).not.toHaveBeenCalled();
    const event = (await dataOf(fake));
    expect(event?.props).toEqual({ n: 1 });
    expect(event?.data).toBeUndefined();
  });

  it("reads hand-written data-params as props, with the page as host", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const fake = fakeModule();
    mount(
      `<djs-droplet data-droplet="plain" data-params='{"page":2}'></djs-droplet>`,
    );
    await tick();
    const event = (await dataOf(fake));
    expect(event?.props).toEqual({ page: 2 });
    expect(event?.host.href).toBe(globalThis.location.href);
  });

  it("prefers data-context over data-params", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const fake = fakeModule();
    mount(
      `<djs-droplet data-droplet="plain" data-context="${encode({ host: "https://a.test", props: { from: "context" } })}" data-params='{"from":"params"}'></djs-droplet>`,
    );
    await tick();
    expect((await dataOf(fake)).props).toEqual({ from: "context" });
  });

  it("validates props in the browser before _data, and sends the result", async () => {
    const fetchSpy = vi.fn(async () => json({ data: "ok" }));
    vi.stubGlobal("fetch", fetchSpy);
    const fake = fakeModule({ validate: vi.fn(async () => ({ page: 2 })) });
    mount(
      `<djs-droplet data-droplet="hello" data-params='{"page":"2"}'></djs-droplet>`,
    );
    await tick();
    await tick();
    expect(fake.validate).toHaveBeenCalledWith({ page: "2" });
    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body)).props).toEqual({ page: 2 });
    expect((await dataOf(fake)).props).toEqual({ page: 2 });
  });

  it("renders nothing when the schema refuses the props", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fake = fakeModule({
      validate: vi.fn(async () => Promise.reject(new Error("Invalid props: page: Expected number"))),
    });
    const el = mount(
      `<djs-droplet data-droplet="hello" data-params='{"page":"x"}'></djs-droplet>`,
    );
    await tick();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(fake.default).not.toHaveBeenCalled();
    expect(fake.handleError).not.toHaveBeenCalled();
    expect(fake.renderError).not.toHaveBeenCalled();
    expect(String(error.mock.calls[0]?.[1])).toContain("Invalid props");
    expect(el.querySelector("[data-droplet-entry]")?.childNodes.length).toBe(0);
  });

  it("shows +error.svelte for a { error } from _data, through handleError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: { message: "Sorry" } }, { status: 500 })));
    const fake = fakeModule({ handleError: vi.fn(async () => ({ message: "[hello] Sorry" })) });
    mount(
      `<djs-droplet data-droplet="hello" data-context="${encode({ props: {} })}"></djs-droplet>`,
    );
    await tick();
    await tick();
    expect(fake.load).not.toHaveBeenCalled();
    // Mounted at once with the data to come; its rejection reached the boundary.
    expect(fake.default).toHaveBeenCalledOnce();
    expect(fake.handleError).toHaveBeenCalledWith({ message: "Sorry" });
    expect(fake.renderError.mock.calls[0]?.[1]).toEqual({ message: "[hello] Sorry" });
  });

  it("renders nothing for error(), a redirect or an unhandled answer from _data", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const response of [
      json({ message: "Forbidden" }, { status: 403 }),
      json({ message: "Internal Server Error" }, { status: 500 }),
      new Response(null, { status: 0 }),
    ]) {
      const fetchSpy = vi.fn(async () => response);
      vi.stubGlobal("fetch", fetchSpy);
      const fake = fakeModule();
      const el = mount(
        `<djs-droplet data-droplet="hello" data-context="${encode({ props: {} })}"></djs-droplet>`,
      );
      await tick();
      await tick();
      expect((fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1].redirect).toBe("manual");
      // Mounted at once, then taken down: nothing the component could show.
      expect(fake.unmount).toHaveBeenCalledOnce();
      expect(fake.handleError).not.toHaveBeenCalled();
      expect(fake.renderError).not.toHaveBeenCalled();
      expect(el.querySelector("[data-droplet-entry]")?.childNodes.length).toBe(0);
    }
    expect(error).toHaveBeenCalled();
  });

  it("passes a load that throws in the browser through handleError into +error.svelte", async () => {
    vi.stubGlobal("fetch", vi.fn());
    vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = new Error("browser boom");
    const handleError = vi.fn(async () => ({ message: "[plain] browser boom" }));
    const fake = fakeModule({ load: vi.fn(async () => Promise.reject(boom)), handleError });
    mount('<djs-droplet data-droplet="plain"></djs-droplet>');
    await tick();
    expect(handleError).toHaveBeenCalledWith(boom);
    expect(fake.default).toHaveBeenCalledOnce();
    expect(fake.renderError.mock.calls[0]?.[1]).toEqual({ message: "[plain] browser boom" });
  });

  it("renders nothing when handleError throws, or there is no error page", async () => {
    vi.stubGlobal("fetch", vi.fn());
    vi.spyOn(console, "error").mockImplementation(() => {});
    const throwing = fakeModule({
      load: vi.fn(async () => Promise.reject(new Error("x"))),
      handleError: vi.fn(async () => Promise.reject(new Error("handler broke"))),
    });
    const a = mount(
      '<djs-droplet data-droplet="plain"><div data-droplet-entry><p>ssr</p></div></djs-droplet>',
    );
    await tick();
    expect(throwing.renderError).not.toHaveBeenCalled();
    expect(a.querySelector("[data-droplet-entry]")?.childNodes.length).toBe(0);

    fakeModule({
      load: vi.fn(async () => Promise.reject(new Error("x"))),
      renderError: vi.fn(() => null),
    });
    const b = mount(
      '<djs-droplet data-droplet="plain"><div data-droplet-entry><p>ssr</p></div></djs-droplet>',
    );
    await tick();
    expect(b.querySelector("[data-droplet-entry]")?.childNodes.length).toBe(0);
  });

  it("hydrates a server-rendered error page from the inline error", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const fake = fakeModule({ handleError: vi.fn(async () => ({ message: "[hello] Sorry" })) });
    const el = mount(
      '<djs-droplet data-droplet="hello" data-droplet-error>' +
        `<script type="application/text" data-droplet-data>${encode({ error: { message: "Sorry" } })}</script>` +
        '<div data-droplet-entry><p>[hello] Sorry</p></div></djs-droplet>',
    );
    await tick();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(fake.load).not.toHaveBeenCalled();
    expect(fake.default).not.toHaveBeenCalled();
    expect(fake.handleError).toHaveBeenCalledWith({ message: "Sorry" });
    // Hydrated in place: the server markup is still there for it.
    const [target, shown] = fake.renderError.mock.calls[0] as unknown as [HTMLElement, unknown];
    expect(shown).toEqual({ message: "[hello] Sorry" });
    expect(target.innerHTML).toBe("<p>[hello] Sorry</p>");
    expect(el.querySelector("[data-droplet-entry]")).toBe(target);
  });

  it("leaves a server-rendered error page alone when it does not hydrate", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const importSpy = vi.fn();
    mod.DjsDropletElement.importModule = importSpy as never;
    const el = mount(
      '<djs-droplet data-droplet="clock" data-droplet-error><div data-droplet-entry><p>sorry</p></div></djs-droplet>',
    );
    await tick();
    // clock's +error.svelte does not hydrate: nothing loads, the markup stays.
    expect(importSpy).not.toHaveBeenCalled();
    expect(el.innerHTML).toContain("<p>sorry</p>");
  });

  it("reports a fragment from another build and keeps its server HTML", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const events: CustomEvent[] = [];
    const listener = (event: Event) => events.push(event as CustomEvent);
    window.addEventListener("droplets:stale", listener);
    try {
      const el = mount(
        '<djs-droplet data-droplet="hello" data-build="new999"><div data-droplet-entry><p>ssr</p></div></djs-droplet>',
      );
      await tick();
      expect(events).toHaveLength(1);
      expect(events[0]?.target).toBe(el);
      expect(events[0]?.detail).toEqual({ element: "djs-droplet", droplet: "hello", loaded: "test01", served: "new999" });
      // No hydration with a loader from another build.
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(el.innerHTML).toContain("<p>ssr</p>");
    } finally {
      window.removeEventListener("droplets:stale", listener);
    }
  });

  it("stays quiet when the builds match", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const listener = vi.fn();
    window.addEventListener("droplets:stale", listener);
    mount('<djs-droplet data-droplet="clock" data-build="test01"></djs-droplet>');
    await tick();
    window.removeEventListener("droplets:stale", listener);
    expect(listener).not.toHaveBeenCalled();
  });

  it("reports a stale build from the _data header and takes the droplet down", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ data: {} }, { headers: { "x-droplets-build": "new999" } })));
    const fake = fakeModule();
    const listener = vi.fn();
    window.addEventListener("droplets:stale", listener);
    const el = mount(
      `<djs-droplet data-droplet="hello" data-context="${encode({ props: {} })}"></djs-droplet>`,
    );
    await tick();
    await tick();
    window.removeEventListener("droplets:stale", listener);
    expect(listener).toHaveBeenCalledOnce();
    expect(fake.unmount).toHaveBeenCalledOnce();
    // A deploy is not the droplet's fault: no error page.
    expect(fake.handleError).not.toHaveBeenCalled();
    expect(fake.renderError).not.toHaveBeenCalled();
    expect(el.querySelector("[data-droplet-entry]")?.childNodes.length).toBe(0);
  });

  it("hydrates with the load's promise fields settled, as the server rendered", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const fake = fakeModule({ load: vi.fn(async () => ({ title: "Hi", comments: Promise.resolve(["a"]) })) });
    mount(
      '<djs-droplet data-droplet="hello">' +
        `<script type="application/text" data-droplet-data>${encode({ data: {} })}</script>` +
        "<div data-droplet-entry><p>ssr</p></div></djs-droplet>",
    );
    await tick();
    const data = fake.default.mock.calls[0]?.[1];
    expect(data).not.toBeInstanceOf(Promise);
    expect(data).toEqual({ title: "Hi", comments: ["a"] });
  });

  it("mounts at once with data as a promise, its fields as the load returned them", async () => {
    const answer = deferredResponse();
    vi.stubGlobal("fetch", vi.fn(() => answer.promise));
    const comments = Promise.resolve(["a"]);
    const fake = fakeModule({ load: vi.fn(async (event: LoadEvent) => ({ who: event.data, comments })) });
    mount(
      `<djs-droplet data-droplet="hello" data-context="${encode({ props: {} })}"></djs-droplet>`,
    );
    await tick();
    // Before _data answered.
    expect(fake.default).toHaveBeenCalledOnce();
    const data = fake.default.mock.calls[0]?.[1];
    expect(data).toBeInstanceOf(Promise);
    answer.resolve(json({ data: "Remote" }));
    const value = (await data) as { who: unknown; comments: unknown };
    expect(value.who).toBe("Remote");
    expect(value.comments).toBe(comments);
  });

  it("hydrates from inline data without validating or fetching", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const fake = fakeModule({ validate: vi.fn() });

    mount(
      `<djs-droplet data-droplet="hello">` +
        `<script type="application/text" data-droplet-context>${encode({ host: "https://host.test/a", props: { page: 2 } })}</script>` +
        `<script type="application/text" data-droplet-data>${encode({ data: { who: "Inline" } })}</script>` +
        `<div data-droplet-entry><p>ssr</p></div></djs-droplet>`,
    );
    await tick();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(fake.validate).not.toHaveBeenCalled();
    const event = (await dataOf(fake));
    expect(event?.data).toEqual({ who: "Inline" });
    expect(event?.props).toEqual({ page: 2 });
    expect(event?.host.href).toBe(globalThis.location.href);
  });

  it("treats an inline envelope without data as present: no _data", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const fake = fakeModule();
    mount(
      `<djs-droplet data-droplet="hello">` +
        `<script type="application/text" data-droplet-data>${encode({})}</script>` +
        `<div data-droplet-entry></div></djs-droplet>`,
    );
    await tick();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((await dataOf(fake)).data).toBeUndefined();
  });
});

type ChildrenHost = import("../../src/runtime/entry-client.ts").DropletChildrenHost;
type RenderInfo = import("../../src/runtime/entry-client.ts").DropletRenderInfo;
type MarkerInstance = { marker: HTMLElement; host: ChildrenHost };

/**
 * A module whose component renders its children: a `[data-droplet-children]`
 * marker the host fills, adopted when the server rendered one. `unmount`
 * does what Svelte does: the DOM goes first, the component's teardown runs
 * after.
 */
function markerModule(overrides: Record<string, unknown> = {}) {
  const show = (target: HTMLElement, host: ChildrenHost, info?: RenderInfo): MarkerInstance => {
    let marker = (info?.markers()[0] as HTMLElement | undefined) ?? target.querySelector<HTMLElement>("[data-droplet-children]");
    if (!marker) {
      marker = document.createElement("div");
      marker.setAttribute("data-droplet-children", "");
      target.appendChild(marker);
    }
    host.fill(marker);
    return { marker, host };
  };
  return fakeModule({
    default: vi.fn((target: HTMLElement, _data: unknown, host: ChildrenHost, info?: RenderInfo) => show(target, host, info)),
    renderError: vi.fn((target: HTMLElement, _error: unknown, host: ChildrenHost, info?: RenderInfo) => show(target, host, info)),
    unmount: vi.fn((instance: MarkerInstance) => {
      instance.marker.remove();
      instance.host.empty(instance.marker);
    }),
    ...overrides,
  });
}

/** The host's container, wherever it is in the element. */
const containerOf = (el: HTMLElement) =>
  Array.from(el.querySelectorAll<HTMLElement>("[data-droplet-slot]")).find((c) => c.closest("[data-droplet]") === el) ?? null;
/** The container under the element, where it waits hidden. */
const parkedIn = (el: HTMLElement) => el.querySelector<HTMLElement>(":scope > [data-droplet-slot]");
/** The container inside the droplet's own marker. */
const filledIn = (el: HTMLElement) =>
  Array.from(el.querySelectorAll<HTMLElement>(":scope > [data-droplet-entry] [data-droplet-children] > [data-droplet-slot]"))
    .find((c) => c.closest("[data-droplet]") === el) ?? null;

const ssrWithMarker = (droplet: string, extra = "") =>
  `<djs-droplet data-droplet="${droplet}"${extra}>` +
  `<script type="application/text" data-droplet-data>${encode({ data: {} })}</script>` +
  '<div data-droplet-entry><article><h1>ssr</h1><div data-droplet-children style="display: contents"></div></article></div>';

describe("the droplet's stylesheet", () => {
  /** Holds back `load` and `error` of the droplet's `style.css` until the test lets them through. */
  function holdStylesheet() {
    const held: Array<() => void> = [];
    const dispatch = HTMLLinkElement.prototype.dispatchEvent;
    // happy-dom's dispatch goes through `this.dispatchEvent` again: let those through.
    let releasing = false;
    const release = (link: HTMLLinkElement, event: Event) => {
      releasing = true;
      try {
        dispatch.call(link, event);
      } finally {
        releasing = false;
      }
    };
    vi.spyOn(HTMLLinkElement.prototype, "dispatchEvent").mockImplementation(function (this: HTMLLinkElement, event: Event) {
      if (!releasing && this.hasAttribute("data-droplet-style") && (event.type === "load" || event.type === "error")) {
        held.push(() => release(this, event));
        return true;
      }
      return dispatch.call(this, event);
    });
    return { held, fail: (link: HTMLLinkElement) => release(link, new Event("error")) };
  }

  it("links a host-written droplet's style.css inside itself, its stylesheets preloaded, and mounts once it loaded", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const { held } = holdStylesheet();
    const fake = fakeModule();
    const el = mount('<djs-droplet data-droplet="plain"></djs-droplet>');

    const links = Array.from(el.querySelectorAll(":scope > link")).map((link) => link.outerHTML);
    expect(links).toEqual([
      '<link rel="preload" as="style" href="http://drops.test/assets/Badge-1.css" data-droplet-preload="">',
      '<link rel="preload" as="style" href="http://drops.test/assets/plain-2.css" data-droplet-preload="">',
      '<link rel="stylesheet" href="http://drops.test/droplets/plain/style.css?c=test01" data-droplet-style="">',
    ]);
    // Before the content root, nothing in <head> but the global stylesheet.
    expect(el.querySelector(":scope > link[data-droplet-style] + [data-droplet-entry]")).not.toBeNull();
    expect(document.head.querySelector('link[href*="style.css"]')).toBeNull();

    // The bundle is there, the stylesheet is not: no mount yet.
    await tick();
    expect(mod.DjsDropletElement.importModule).toHaveBeenCalledOnce();
    expect(fake.default).not.toHaveBeenCalled();

    held.forEach((release) => release());
    await tick();
    expect(fake.default).toHaveBeenCalledOnce();
  });

  it("mounts when the stylesheet fails, too", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const { fail } = holdStylesheet();
    const fake = fakeModule();
    const el = mount('<djs-droplet data-droplet="plain"></djs-droplet>');
    await tick();
    expect(fake.default).not.toHaveBeenCalled();
    fail(el.querySelector<HTMLLinkElement>(":scope > link[data-droplet-style]")!);
    await tick();
    expect(fake.default).toHaveBeenCalledOnce();
  });

  it("keeps the link a fragment brought, adds none, and waits for it before mounting", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const { held } = holdStylesheet();
    const fake = fakeModule();
    const context = encode({ host: "https://host.test/", props: {} });
    const el = mount(
      `<djs-droplet data-droplet="plain" data-context="${context}">` +
        '<link rel="stylesheet" href="http://drops.test/droplets/plain/style.css?c=test01" data-droplet-style>' +
        '<div style="display: contents" data-droplet-entry></div></djs-droplet>',
    );
    await tick();
    expect(el.querySelectorAll(":scope > link")).toHaveLength(1);
    expect(fake.default).not.toHaveBeenCalled();
    held.forEach((release) => release());
    await tick();
    expect(fake.default).toHaveBeenCalledOnce();
    expect(el.querySelectorAll(":scope > link[data-droplet-style]")).toHaveLength(1);
  });

  it("hydrates server markup without waiting for the stylesheet", async () => {
    vi.stubGlobal("fetch", vi.fn());
    holdStylesheet();
    const fake = fakeModule();
    mount(
      '<djs-droplet data-droplet="plain">' +
        `<script type="application/text" data-droplet-data>${encode({ data: {} })}</script>` +
        '<link rel="stylesheet" href="http://drops.test/droplets/plain/style.css?c=test01" data-droplet-style>' +
        '<div style="display: contents" data-droplet-entry><p>ssr</p></div></djs-droplet>',
    );
    await tick();
    expect(fake.default).toHaveBeenCalledOnce();
  });
});

describe("children", () => {
  it("keeps the allowed direct children and removes anything loose, with a warning in dev", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    markerModule();
    const el = mount(
      '<djs-droplet data-droplet="plain">\n' +
        '  <p>loose</p> stray text <!-- note -->\n' +
        `  <script type="application/text" data-droplet-context>${encode({ props: { a: 1 } })}</script>\n` +
        '  <div data-droplet-slot><b>kid</b></div>\n</djs-droplet>',
    );
    // Synchronously at connect: the container, the payload, the content root
    // and the droplet's stylesheet with its preloads (plain has two), nothing else.
    const kinds = Array.from(el.childNodes).map((n) => (n as Element).localName + Array.from((n as Element).attributes ?? []).map((a) => `[${a.name}]`).join(""));
    expect(kinds.sort()).toEqual([
      "div[data-droplet-entry][style]",
      "div[data-droplet-slot][hidden]",
      "link[rel][as][href][data-droplet-preload]",
      "link[rel][as][href][data-droplet-preload]",
      "link[rel][href][data-droplet-style]",
      "script[type][data-droplet-context]",
    ]);
    expect(el.querySelector("b")?.textContent).toBe("kid");
    // One warning per real node: the <p> and the text. Whitespace and the comment go quietly.
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[0]?.[0])).toContain("<div data-droplet-slot>");
    await tick();
    expect(filledIn(el)?.innerHTML).toBe("<b>kid</b>");
  });

  it("puts the container in the server's marker at connect, before anything loads", async () => {
    vi.stubGlobal("fetch", vi.fn());
    let release!: () => void;
    const fake = markerModule();
    mod.DjsDropletElement.importModule = vi.fn(async () => {
      await new Promise<void>((r) => (release = r));
      return fake;
    }) as never;
    const el = mount(`${ssrWithMarker("hello")}<div data-droplet-slot><p>kid</p></div></djs-droplet>`);
    // Synchronously: in the marker, shown, the same node the host wrote.
    const container = filledIn(el);
    expect(container).not.toBeNull();
    expect(container?.hidden).toBe(false);
    expect(container?.innerHTML).toBe("<p>kid</p>");
    expect(parkedIn(el)).toBeNull();
    await tick();
    expect(fake.default).not.toHaveBeenCalled();
    expect(filledIn(el)).toBe(container);
    release();
    await tick();
    expect(fake.default).toHaveBeenCalledOnce();
    expect(filledIn(el)).toBe(container);
  });

  it("takes the container out right before hydrate and back in through fill, the same node", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const seen: Array<{ parent: Node | null; hidden: boolean }> = [];
    const fake = markerModule({
      default: vi.fn((target: HTMLElement, _data: unknown, host: ChildrenHost, info: RenderInfo) => {
        // What an engine sees while it compares the server markup: an empty marker.
        const container = containerOf(target.parentElement as HTMLElement)!;
        seen.push({ parent: container.parentNode, hidden: container.hidden });
        const marker = info.markers()[0] as HTMLElement;
        expect(marker.childNodes.length).toBe(0);
        host.fill(marker);
        return { marker, host };
      }),
    });
    const el = mount(`${ssrWithMarker("hello")}<div data-droplet-slot><p>kid</p></div></djs-droplet>`);
    const container = filledIn(el)!;
    await tick();
    expect(fake.default).toHaveBeenCalledOnce();
    expect(seen).toEqual([{ parent: el, hidden: true }]);
    expect(filledIn(el)).toBe(container);
    expect(container.hidden).toBe(false);
    expect(el.querySelectorAll("p").length).toBe(1);
  });

  it("keeps the container hidden under the element when the server HTML has no marker", async () => {
    vi.stubGlobal("fetch", vi.fn());
    // hello hydrates, clock does not; neither rendered its children.
    for (const droplet of ["hello", "clock"]) {
      markerModule({
        default: vi.fn((_target: HTMLElement, _data: unknown, host: ChildrenHost) => ({ host })),
        unmount: vi.fn(),
      });
      const el = mount(
        `<djs-droplet data-droplet="${droplet}">` +
          `<script type="application/text" data-droplet-data>${encode({ data: {} })}</script>` +
          '<div data-droplet-entry><p>ssr</p></div><div data-droplet-slot><p>kid</p></div></djs-droplet>',
      );
      const container = parkedIn(el);
      expect(container?.hidden, droplet).toBe(true);
      await tick();
      expect(parkedIn(el), droplet).toBe(container);
      expect(container?.hidden, droplet).toBe(true);
      expect(container?.isConnected, droplet).toBe(true);
    }
  });

  it("ignores a nested droplet's marker", async () => {
    vi.stubGlobal("fetch", vi.fn());
    markerModule({ default: vi.fn((_t: HTMLElement, _d: unknown, host: ChildrenHost) => ({ host })), unmount: vi.fn() });
    const nested =
      '<djs-droplet data-droplet="clock">' +
      '<div data-droplet-entry><div data-droplet-children id="theirs"></div></div></djs-droplet>';
    const el = mount(
      '<djs-droplet data-droplet="hello">' +
        `<script type="application/text" data-droplet-data>${encode({ data: {} })}</script>` +
        `<div data-droplet-entry><section>${nested}</section></div><div data-droplet-slot><p>kid</p></div></djs-droplet>`,
    );
    expect(parkedIn(el)?.hidden).toBe(true);
    expect(el.querySelector("#theirs")?.childNodes.length).toBe(0);
    await tick();
    expect(parkedIn(el)?.hidden).toBe(true);
  });

  it("hides a client-only droplet's container at connect and fills the marker on mount", async () => {
    vi.stubGlobal("fetch", vi.fn());
    markerModule();
    const el = mount(
      '<djs-droplet data-droplet="plain">\n  <div data-droplet-slot><p>kid</p> <b>two</b></div>\n</djs-droplet>',
    );
    // Synchronously, before anything loads: out of sight, still in the document.
    const container = parkedIn(el);
    expect(container?.hidden).toBe(true);
    expect(container?.isConnected).toBe(true);
    expect(container?.innerHTML).toBe("<p>kid</p> <b>two</b>");

    await tick();
    expect(filledIn(el)).toBe(container);
    expect(container?.hidden).toBe(false);
    expect(el.querySelectorAll("p").length).toBe(1);
  });

  it("fill moves the container in and shows it; empty moves it back out and hides it, never removes it", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const fake = markerModule();
    const el = mount(
      '<djs-droplet data-droplet="plain"><div data-droplet-slot><p>kid</p></div></djs-droplet>',
    );
    await tick();
    const { marker, host } = fake.default.mock.results[0]?.value as MarkerInstance;
    const container = containerOf(el)!;
    expect(container.parentNode).toBe(marker);

    // The component's `if` turned false: `empty` runs while the marker is still in the DOM.
    host.empty(marker);
    expect(container.parentNode).toBe(el);
    expect(container.hidden).toBe(true);
    expect(container.isConnected).toBe(true);
    expect(el.querySelectorAll("p").length).toBe(1);

    // True again: a new marker.
    const next = document.createElement("div");
    next.setAttribute("data-droplet-children", "");
    el.querySelector("[data-droplet-entry]")?.appendChild(next);
    host.fill(next);
    expect(container.parentNode).toBe(next);
    expect(container.hidden).toBe(false);
  });

  it("waits for a marker set up in a detached fragment to reach the document", async () => {
    vi.stubGlobal("fetch", vi.fn());
    let detached: HTMLElement | null = null;
    markerModule({
      // The marker is set up in a fragment, attached afterwards.
      default: vi.fn((target: HTMLElement, _data: unknown, host: ChildrenHost) => {
        const fragment = document.createDocumentFragment();
        const marker = document.createElement("div");
        marker.setAttribute("data-droplet-children", "");
        fragment.appendChild(marker);
        host.fill(marker);
        detached = marker;
        expect(marker.childNodes.length).toBe(0);
        target.appendChild(fragment);
        return { marker, host };
      }),
    });
    const el = mount(
      '<djs-droplet data-droplet="plain"><div data-droplet-slot><p>kid</p></div></djs-droplet>',
    );
    await tick();
    expect(filledIn(el)?.parentElement).toBe(detached);
    expect(filledIn(el)?.hidden).toBe(false);
  });

  it("carries the container over an update and into the error page", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const fake = markerModule();
    const el = mount(
      '<djs-droplet data-droplet="plain"><div data-droplet-slot><p>kid</p></div></djs-droplet>',
    );
    await tick();
    const container = containerOf(el)!;
    const first = container.parentElement;

    await el.update({ droplet: "plain" });
    expect(fake.unmount).toHaveBeenCalledOnce();
    expect(fake.default).toHaveBeenCalledTimes(2);
    expect(containerOf(el)).toBe(container);
    expect(container.parentElement).not.toBe(first);
    expect(filledIn(el)).toBe(container);
    expect(el.querySelectorAll("p").length).toBe(1);

    // The next update fails in the browser: the error page gets them.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = markerModule({ load: vi.fn(async () => Promise.reject(new Error("x"))) });
    await el.update({ droplet: "plain" });
    await tick();
    expect(failing.renderError).toHaveBeenCalledOnce();
    expect(filledIn(el)).toBe(container);
    expect(container.hidden).toBe(false);
  });

  it("shows the children as they were when the droplet renders nothing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const cases: Array<[string, () => void, string]> = [
      ["bundle fails to load", () => {
        vi.stubGlobal("fetch", vi.fn());
        mod.DjsDropletElement.importModule = vi.fn(async () => Promise.reject(new Error("offline"))) as never;
      }, "plain"],
      ["schema refuses the props", () => {
        vi.stubGlobal("fetch", vi.fn());
        markerModule({ validate: vi.fn(async () => Promise.reject(new Error("Invalid props"))) });
      }, "hello"],
      ["_data answers something else", () => {
        vi.stubGlobal("fetch", vi.fn(async () => json({ message: "Forbidden" }, { status: 403 })));
        markerModule();
      }, "hello"],
      ["_data comes from another build", () => {
        vi.stubGlobal("fetch", vi.fn(async () => json({ data: {} }, { headers: { "x-droplets-build": "new999" } })));
        markerModule();
      }, "hello"],
      ["handleError throws", () => {
        vi.stubGlobal("fetch", vi.fn());
        markerModule({
          load: vi.fn(async () => Promise.reject(new Error("x"))),
          handleError: vi.fn(async () => Promise.reject(new Error("broke"))),
        });
      }, "plain"],
    ];
    for (const [name, arrange, droplet] of cases) {
      arrange();
      const el = mount(
        `<djs-droplet data-droplet="${droplet}" data-params='{"page":"x"}'><div data-droplet-slot><p>kid</p><em>two</em></div></djs-droplet>`,
      );
      const container = parkedIn(el);
      expect(container?.hidden, name).toBe(true);
      await tick();
      await tick();
      expect(el.querySelector(":scope > [data-droplet-entry]")?.childNodes.length, name).toBe(0);
      expect(parkedIn(el), name).toBe(container);
      expect(container?.hidden, name).toBe(false);
      expect(container?.innerHTML, name).toBe("<p>kid</p><em>two</em>");
      el.remove();
    }
  });

  it("puts revealed children back to work on the next update", async () => {
    vi.stubGlobal("fetch", vi.fn());
    vi.spyOn(console, "error").mockImplementation(() => {});
    markerModule({
      load: vi.fn(async () => Promise.reject(new Error("x"))),
      handleError: vi.fn(async () => Promise.reject(new Error("broke"))),
    });
    const el = mount(
      '<djs-droplet data-droplet="plain"><div data-droplet-slot><p>kid</p></div></djs-droplet>',
    );
    await tick();
    expect(parkedIn(el)?.hidden).toBe(false);

    markerModule();
    await el.update({ droplet: "plain" });
    expect(parkedIn(el)).toBeNull();
    expect(filledIn(el)?.innerHTML).toBe("<p>kid</p>");
  });

  it("uses its own content root and payloads, not a nested droplet's", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const fake = markerModule();
    const inner =
      '<djs-droplet data-droplet="clock">' +
      `<script type="application/text" data-droplet-context>${encode({ host: "https://inner.test", props: { from: "inner" } })}</script>` +
      `<script type="application/text" data-droplet-data>${encode({ data: { from: "inner" } })}</script>` +
      '<div data-droplet-entry><p>inner</p></div><div data-droplet-slot><i>theirs</i></div></djs-droplet>';
    const el = mount(
      `<djs-droplet data-droplet="plain" data-params='{"from":"outer"}'><div data-droplet-slot>${inner}</div></djs-droplet>`,
    );
    await tick();
    const [target] = fake.default.mock.calls[0] as unknown as [HTMLElement];
    const event = await dataOf(fake);
    expect(target.parentElement).toBe(el);
    expect(event.props).toEqual({ from: "outer" });
    expect(event.data).toBeUndefined();
    // The nested droplet moved along, markup intact, its own container untouched.
    const nested = filledIn(el)?.firstElementChild as HTMLElement;
    expect(nested.dataset["droplet"]).toBe("clock");
    expect(nested.querySelector("[data-droplet-entry]")?.innerHTML).toBe("<p>inner</p>");
    expect(nested.querySelector(":scope > [data-droplet-slot]")?.innerHTML).toBe("<i>theirs</i>");
  });

  it("moves with moveBefore where the browser has it, and re-inserts otherwise", async () => {
    vi.stubGlobal("fetch", vi.fn());
    expect(typeof mod.DjsDropletElement.prototype.connectedMoveCallback).toBe("function");
    const proto = Element.prototype as Element & { moveBefore?: (node: Node, child: Node | null) => void };
    const moveBefore = vi.fn(function (this: Element, node: Node, child: Node | null) {
      // As in browsers: both sides must be in the same connected state.
      if (node.isConnected !== this.isConnected) throw new Error("HierarchyRequestError");
      this.insertBefore(node, child);
    });
    proto.moveBefore = moveBefore;
    try {
      markerModule();
      const el = mount(
        '<djs-droplet data-droplet="plain"><div data-droplet-slot><p>kid</p></div></djs-droplet>',
      );
      await tick();
      expect(filledIn(el)?.innerHTML).toBe("<p>kid</p>");
      // Into the marker: one move, no re-insert.
      expect(moveBefore).toHaveBeenCalledTimes(1);

      // The marker already left the document: moveBefore refuses, append stands in.
      const fake = markerModule();
      const other = mount(
        '<djs-droplet data-droplet="plain"><div data-droplet-slot><p>kid</p></div></djs-droplet>',
      );
      await tick();
      const { marker, host } = fake.default.mock.results[0]?.value as MarkerInstance;
      marker.remove();
      moveBefore.mockClear();
      host.empty(marker);
      expect(moveBefore).toHaveBeenCalledOnce();
      expect(parkedIn(other)?.innerHTML).toBe("<p>kid</p>");
    } finally {
      delete proto.moveBefore;
    }
  });
});

describe("leaving the document", () => {
  it("stays alive through a remove and re-insert in the same task", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const fake = markerModule();
    const el = mount(
      '<djs-droplet data-droplet="plain"><div data-droplet-slot><p>kid</p></div></djs-droplet>',
    );
    await tick();
    expect(fake.default).toHaveBeenCalledOnce();
    const container = filledIn(el)!;

    // What a host without moveBefore does to move the element, and what an engine re-ordering its parent does.
    const parent = el.parentElement!;
    el.remove();
    parent.appendChild(el);
    await tick();
    expect(fake.unmount).not.toHaveBeenCalled();
    expect(fake.default).toHaveBeenCalledOnce();
    expect(filledIn(el)).toBe(container);
    expect(container.hidden).toBe(false);
  });

  it("tears down once it is really gone, and renders anew when put back later", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const fake = markerModule();
    const el = mount(
      '<djs-droplet data-droplet="plain"><div data-droplet-slot><p>kid</p></div></djs-droplet>',
    );
    await tick();
    const parent = el.parentElement!;
    el.remove();
    expect(fake.unmount).not.toHaveBeenCalled();
    await tick();
    expect(fake.unmount).toHaveBeenCalledOnce();
    // The container came back under the element, hidden, before the component went.
    expect(parkedIn(el)?.hidden).toBe(true);
    expect(parkedIn(el)?.innerHTML).toBe("<p>kid</p>");

    parent.appendChild(el);
    await tick();
    expect(fake.default).toHaveBeenCalledTimes(2);
    expect(filledIn(el)?.innerHTML).toBe("<p>kid</p>");
  });
});

describe("_data per element", () => {
  const deferred = () => {
    let resolve!: (value: Response) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<Response>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
  // Out for a tick: a re-insert in the same task would keep the instance.
  const reconnect = async (el: HTMLElement) => {
    const parent = el.parentElement!;
    el.remove();
    await tick();
    parent.appendChild(el);
  };

  it("awaits the request in flight when reconnected with the same context", async () => {
    const pending = deferred();
    const fetchSpy = vi.fn(() => pending.promise);
    vi.stubGlobal("fetch", fetchSpy);
    const fake = fakeModule({ validate: vi.fn(async (props: Record<string, unknown>) => props) });
    const el = mount(
      `<djs-droplet data-droplet="hello" data-params='{"page":1}'></djs-droplet>`,
    );
    await tick();
    expect(fetchSpy).toHaveBeenCalledOnce();
    await reconnect(el);
    await tick();
    expect(fetchSpy).toHaveBeenCalledOnce();

    pending.resolve(json({ data: { who: "Late" } }));
    await tick();
    // Each run mounted at once; the first went with the disconnect. Both
    // waited on the one request.
    expect(fake.default).toHaveBeenCalledTimes(2);
    expect(fake.unmount).toHaveBeenCalledOnce();
    expect((await dataOf(fake, 1)).data).toEqual({ who: "Late" });
    expect(fake.validate).toHaveBeenCalledTimes(2);
  });

  it("reuses the answer on reconnect, and runs the cheap steps again", async () => {
    const fetchSpy = vi.fn(async () => json({ data: { n: 1 } }));
    vi.stubGlobal("fetch", fetchSpy);
    const fake = fakeModule();
    const el = mount(
      `<djs-droplet data-droplet="hello" data-params='{"page":1}'></djs-droplet>`,
    );
    await tick();
    await tick();
    await reconnect(el);
    await tick();
    await tick();
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fake.unmount).toHaveBeenCalledOnce();
    expect(fake.load).toHaveBeenCalledTimes(2);
    expect(fake.default).toHaveBeenCalledTimes(2);
    expect((await dataOf(fake, 1)).data).toEqual({ n: 1 });
  });

  it("asks again when the context changed", async () => {
    const fetchSpy = vi.fn(async () => json({ data: {} }));
    vi.stubGlobal("fetch", fetchSpy);
    fakeModule();
    const el = mount(
      `<djs-droplet data-droplet="hello" data-params='{"page":1}'></djs-droplet>`,
    );
    await tick();
    await tick();
    el.dataset["params"] = '{"page":2}';
    await reconnect(el);
    await tick();
    await tick();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const bodies = fetchSpy.mock.calls.map((call) => JSON.parse(String((call as unknown as [string, RequestInit])[1].body)).props);
    expect(bodies).toEqual([{ page: 1 }, { page: 2 }]);
  });

  it("asks again after an update", async () => {
    const fetchSpy = vi.fn(async () => json({ data: {} }));
    vi.stubGlobal("fetch", fetchSpy);
    fakeModule();
    const el = mount(
      `<djs-droplet data-droplet="hello" data-params='{"page":1}'></djs-droplet>`,
    );
    await tick();
    await tick();
    await el.update({ droplet: "hello" });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    await reconnect(el);
    await tick();
    await tick();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("asks again after an error answer or a failed request", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = vi.fn(async () => json({ error: { message: "Sorry" } }, { status: 500 }));
    vi.stubGlobal("fetch", failing);
    const fake = fakeModule();
    const el = mount(
      `<djs-droplet data-droplet="hello" data-params='{"page":1}'></djs-droplet>`,
    );
    await tick();
    await tick();
    expect(fake.renderError).toHaveBeenCalledOnce();
    await reconnect(el);
    await tick();
    await tick();
    expect(failing).toHaveBeenCalledTimes(2);

    const rejecting = vi.fn(async () => Promise.reject(new TypeError("Failed to fetch")));
    vi.stubGlobal("fetch", rejecting);
    const other = mount(
      `<djs-droplet data-droplet="hello" data-params='{"page":1}'></djs-droplet>`,
    );
    await tick();
    await tick();
    await reconnect(other);
    await tick();
    await tick();
    expect(rejecting).toHaveBeenCalledTimes(2);
  });

  it("never shares a request between elements", async () => {
    const fetchSpy = vi.fn(async () => json({ data: {} }));
    vi.stubGlobal("fetch", fetchSpy);
    fakeModule();
    mount(`<djs-droplet data-droplet="hello" data-params='{"page":1}'></djs-droplet>`);
    mount(`<djs-droplet data-droplet="hello" data-params='{"page":1}'></djs-droplet>`);
    await tick();
    await tick();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe("clicks before hydration", () => {
  const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };

  /** The droplet's bundle, held back until `release` so clicks can land first. */
  function slowModule(overrides: Record<string, unknown> = {}) {
    const gate = deferred<void>();
    const fake = fakeModule(overrides);
    mod.DjsDropletElement.importModule = vi.fn(async () => {
      await gate.promise;
      return fake;
    }) as never;
    return { fake, release: gate.resolve };
  }

  type ClickSpy = ReturnType<typeof vi.fn<(event: Event) => void>>;

  /** A component that listens on its buttons once it runs: what hydration adds. */
  function listening(spy: ClickSpy) {
    return vi.fn((target: HTMLElement) => {
      target.querySelectorAll("button").forEach((button) => button.addEventListener("click", spy));
      return {};
    });
  }

  /** Dispatches a click as a user would; `false` when a listener prevented it. */
  const click = (node: Element, init: MouseEventInit = {}) =>
    node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, composed: true, ...init }));

  const targets = (spy: ClickSpy) => spy.mock.calls.map((call) => call[0].target);

  const ssr = (droplet: string, markup: string, extra = "") =>
    `<djs-droplet data-droplet="${droplet}"${extra}>` +
    `<script type="application/text" data-droplet-data>${encode({ data: {} })}</script>` +
    `<div data-droplet-entry>${markup}</div></djs-droplet>`;

  it("holds clicks on server markup that hydrates, replays them in order, then steps aside", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const spy = vi.fn<(event: Event) => void>();
    const { release } = slowModule({ default: listening(spy) });
    const el = mount(ssr("hello", '<button id="a">a</button><button id="b">b</button>'));
    const a = el.querySelector("#a")!;
    const b = el.querySelector("#b")!;

    expect(click(a)).toBe(false);
    expect(click(b)).toBe(false);
    expect(click(a)).toBe(false);
    await tick();
    expect(spy).not.toHaveBeenCalled();

    release();
    await tick();
    expect(targets(spy)).toEqual([a, b, a]);
    expect((spy.mock.calls[0]?.[0] as Event).bubbles).toBe(true);

    // Hydrated: the listener is gone, the component sees the click itself.
    expect(click(a)).toBe(true);
    expect(spy).toHaveBeenCalledTimes(4);
  });

  it("leaves clicks alone when nothing will hydrate", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const added: Array<[EventTarget, string]> = [];
    const original = EventTarget.prototype.addEventListener;
    vi.spyOn(EventTarget.prototype, "addEventListener").mockImplementation(function (this: EventTarget, type, ...rest) {
      added.push([this, type]);
      return original.call(this, type, ...rest);
    });
    const importSpy = vi.fn(async () => fakeModule());
    mod.DjsDropletElement.importModule = importSpy as never;

    // hydrate = false: the markup stays as the server made it.
    const stays = mount(ssr("clock", '<button id="s">s</button>'));
    // Its +error.svelte does not hydrate either.
    const error = mount(ssr("clock", '<button id="e">e</button>', " data-droplet-error"));
    // Client-only: no server markup to click on.
    const clientOnly = mount('<djs-droplet data-droplet="plain"></djs-droplet>');
    expect(click(stays.querySelector("#s")!)).toBe(true);
    expect(click(error.querySelector("#e")!)).toBe(true);
    await tick();
    expect(importSpy).toHaveBeenCalledOnce();
    expect(clientOnly.querySelector("[data-droplet-entry]")).not.toBeNull();
    expect(added.filter(([target, type]) => type === "click" && target instanceof Element && target.matches("[data-droplet-entry]"))).toEqual([]);
  });

  it("holds clicks on a server-rendered error page that hydrates", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const spy = vi.fn<(event: Event) => void>();
    const { fake, release } = slowModule({ renderError: listening(spy) });
    const el = mount(
      '<djs-droplet data-droplet="hello" data-droplet-error>' +
        `<script type="application/text" data-droplet-data>${encode({ error: { message: "Sorry" } })}</script>` +
        '<div data-droplet-entry><p>Sorry</p><button id="retry">0</button></div></djs-droplet>',
    );
    const retry = el.querySelector("#retry")!;
    expect(click(retry)).toBe(false);
    release();
    await tick();
    expect(fake.default).not.toHaveBeenCalled();
    expect(targets(spy)).toEqual([retry]);
    expect(click(retry)).toBe(true);
  });

  it("ignores clicks on the host's children in their container and inside a nested droplet", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const spy = vi.fn<(event: Event) => void>();
    const { release } = slowModule({ default: listening(spy) });
    const nested =
      '<djs-droplet data-droplet="clock">' +
      '<div data-droplet-entry><button id="inner">inner</button></div></djs-droplet>';
    const el = mount(
      ssr("hello", `<button id="own">own</button><div data-droplet-children></div>${nested}`).replace(
        /<\/djs-droplet>$/,
        '<div data-droplet-slot><button id="kid">kid</button></div></djs-droplet>',
      ),
    );
    const own = el.querySelector("#own")!;
    const kid = el.querySelector("#kid")!;
    const inner = el.querySelector("#inner")!;
    // The container moved into the marker at connect: the kid's click is still the host's.
    expect(kid.closest("[data-droplet-children]")).not.toBeNull();
    expect(click(own)).toBe(false);
    expect(click(kid)).toBe(true);
    expect(click(inner)).toBe(true);
    release();
    await tick();
    // `listening` picked every button under the root, nested and hosted ones included.
    expect(targets(spy)).toEqual([own]);
  });

  it("replays on the same node, at its current position, with the click's details", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const spy = vi.fn<(event: Event) => void>();
    const { release } = slowModule({ default: listening(spy) });
    const el = mount(ssr("hello", '<button id="a">a</button><button id="moved">b</button>'));
    const button = el.querySelector("#moved") as HTMLElement;
    const rect = (left: number, top: number, width: number, height: number) =>
      ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
    button.getBoundingClientRect = () => rect(100, 50, 200, 100);
    // A quarter of the way in, on both axes.
    click(button, { clientX: 150, clientY: 75, screenX: 1150, screenY: 575, button: 0, buttons: 1, shiftKey: true, metaKey: true, detail: 2 });

    // The page shifted before hydration finished: the button is elsewhere, and smaller.
    button.getBoundingClientRect = () => rect(300, 400, 100, 40);
    release();
    await tick();
    expect(spy).toHaveBeenCalledOnce();
    const replayed = spy.mock.calls[0]?.[0] as MouseEvent;
    expect(replayed.target).toBe(button);
    expect([replayed.clientX, replayed.clientY]).toEqual([325, 410]);
    expect([replayed.screenX, replayed.screenY]).toEqual([1325, 910]);
    expect([replayed.button, replayed.buttons, replayed.detail]).toEqual([0, 1, 2]);
    expect([replayed.shiftKey, replayed.metaKey, replayed.ctrlKey, replayed.altKey]).toEqual([true, true, false, false]);
    expect(replayed.cancelable).toBe(true);
  });

  it("counts the 1500 ms from the hydrate attempt, caps a click at 10 s, and drops nodes that left", async () => {
    vi.stubGlobal("fetch", vi.fn());
    let clock = 0;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    const spy = vi.fn<(event: Event) => void>();
    const scenario = async (hydrateTakes: number, releaseAt: number) => {
      spy.mockClear();
      const { release } = slowModule({
        default: vi.fn((target: HTMLElement) => {
          // Hydration drops one node, as a mismatch would, and takes its time.
          target.querySelector("#gone")?.remove();
          target.querySelectorAll("button").forEach((button) => button.addEventListener("click", spy));
          clock += hydrateTakes;
          return {};
        }),
      });
      const el = mount(ssr("hello", '<button id="old">o</button><button id="gone">g</button><button id="fresh">f</button>'));
      const gone = el.querySelector("#gone")!;
      const goneSpy = vi.spyOn(gone, "dispatchEvent");
      clock = 1_000;
      click(el.querySelector("#old")!);
      clock = 1_400;
      click(gone);
      click(el.querySelector("#fresh")!);
      goneSpy.mockClear();
      clock = releaseAt;
      release();
      await tick();
      expect(goneSpy).not.toHaveBeenCalled();
      const replayed = targets(spy).map((node) => (node as Element).id);
      el.remove();
      return replayed;
    };
    // A slow download is the framework's time: both clicks still count.
    expect(await scenario(0, 8_000)).toEqual(["old", "fresh"]);
    // An engine that takes over 1500 ms to hydrate: dropped.
    expect(await scenario(1_600, 2_000)).toEqual([]);
    // Over 10 s since the click, however it was held: dropped.
    expect(await scenario(0, 11_200)).toEqual(["fresh"]);
  });

  it("replays a retry on the same node once, and keeps a double click", async () => {
    vi.stubGlobal("fetch", vi.fn());
    let clock = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    const spy = vi.fn<(event: Event) => void>();
    const { release } = slowModule({ default: listening(spy) });
    const el = mount(ssr("hello", '<button id="buy">b</button><button id="zoom">z</button>'));
    const buy = el.querySelector("#buy")!;
    const zoom = el.querySelector("#zoom")!;
    // Nothing happened, so the user clicked again: one purchase.
    click(buy, { detail: 1, clientX: 1 });
    clock = 1_600;
    click(buy, { detail: 1, clientX: 2 });
    // A double click: both.
    clock = 1_700;
    click(zoom, { detail: 1 });
    clock = 1_800;
    click(zoom, { detail: 2 });
    release();
    await tick();
    const calls = spy.mock.calls.map(([event]) => [(event.target as Element).id, (event as MouseEvent).detail]);
    expect(calls).toEqual([["buy", 1], ["zoom", 1], ["zoom", 2]]);
  });

  it("waits for an asynchronous hydrate before replaying", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const spy = vi.fn<(event: Event) => void>();
    const handle = deferred<unknown>();
    const { release } = slowModule({
      default: vi.fn((target: HTMLElement) =>
        handle.promise.then((instance) => {
          target.querySelector("button")?.addEventListener("click", spy);
          return instance;
        })),
    });
    const el = mount(ssr("hello", '<button id="a">a</button>'));
    const a = el.querySelector("#a")!;
    expect(click(a)).toBe(false);
    release();
    await tick();
    // The engine is still rendering: the click waits, and so does the listener.
    expect(spy).not.toHaveBeenCalled();
    expect(click(a)).toBe(false);

    handle.resolve({ live: true });
    await tick();
    expect(targets(spy)).toEqual([a, a]);
    expect(click(a)).toBe(true);
  });

  it("drops the queue and unmounts the late handle when the element leaves mid-hydrate", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const spy = vi.fn<(event: Event) => void>();
    const handle = deferred<unknown>();
    const { fake, release } = slowModule({
      default: vi.fn((target: HTMLElement) => {
        target.querySelector("button")?.addEventListener("click", spy);
        return handle.promise;
      }),
    });
    const el = mount(ssr("hello", '<button id="a">a</button>'));
    expect(click(el.querySelector("#a")!)).toBe(false);
    release();
    await tick();
    expect(fake.default).toHaveBeenCalledOnce();

    el.remove();
    handle.resolve({ id: "late" });
    await tick();
    expect(fake.unmount).toHaveBeenCalledWith({ id: "late" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("stops holding clicks when the droplet renders nothing", async () => {
    vi.stubGlobal("fetch", vi.fn());
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { release } = slowModule({
      default: vi.fn(() => {
        throw new Error("broken");
      }),
      renderError: vi.fn(() => null),
    });
    const el = mount(ssr("hello", '<button id="a">a</button>'));
    expect(click(el.querySelector("#a")!)).toBe(false);
    release();
    await tick();
    const root = el.querySelector("[data-droplet-entry]")!;
    expect(root.childNodes.length).toBe(0);
    // Whatever shows up in the root from now on is not held back.
    const later = document.createElement("button");
    root.appendChild(later);
    expect(click(later)).toBe(true);
  });
});

describe("dev remount", () => {
  const context = { host: "https://host.test/page", props: { page: 1 } };
  /** A fragment as the server answers it: markup, the context inline, the data when it hydrates. */
  const fragment = (droplet: string, markup: string, options: { data?: unknown; error?: boolean; ssr?: boolean; style?: string } = {}) =>
    `<djs-droplet data-droplet="${droplet}"` +
    `${options.ssr === false ? ` data-context="${encode(context)}"` : ""}${options.error ? " data-droplet-error" : ""}>` +
    `${options.ssr === false ? "" : `<script type="application/text" data-droplet-context>${encode(context)}</script>`}` +
    `${"data" in options ? `<script type="application/text" data-droplet-data>${encode(options.data)}</script>` : ""}` +
    `${options.style ? `<link rel="stylesheet" href="${options.style}" data-droplet-style>` : ""}` +
    `<div style="display: contents" data-droplet-entry>${markup}</div></djs-droplet>`;
  const html = (body: string, status = 200) =>
    new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
  const withSlot = (source: string) => source.replace("</djs-droplet>", "<div data-droplet-slot><p>kid</p></div></djs-droplet>");

  it("asks for a server fragment again, with its context, and hydrates the new markup with the value", async () => {
    const fetchSpy = vi.fn(async () =>
      html(fragment("plain", '<h1>v2</h1><div data-droplet-children style="display: contents"></div>', { data: { data: { v: 2 } } })),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const fake = markerModule();
    const el = mount(withSlot(fragment("plain", '<h1>v1</h1><div data-droplet-children style="display: contents"></div>', { data: { data: { v: 1 } } })));
    await tick();
    const container = containerOf(el)!;
    expect(fake.default).toHaveBeenCalledOnce();

    await el.update({ droplet: "plain" });
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://drops.test/droplets/plain");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual(context);
    expect(fake.unmount).toHaveBeenCalledOnce();
    expect(el.querySelector("h1")?.textContent).toBe("v2");
    // Hydrated again: the value, as the server rendered with it.
    expect(fake.default).toHaveBeenCalledTimes(2);
    expect(((await dataOf(fake, 1)) as unknown as { data: unknown }).data).toEqual({ v: 2 });
    expect(fake.default.mock.calls[1]?.[1]).not.toBeInstanceOf(Promise);
    expect(el.querySelectorAll(":scope > [data-droplet-data]").length).toBe(1);
    expect(filledIn(el)).toBe(container);
  });

  it("takes the stylesheet link of the fragment asked for again", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      html(fragment("plain", "<p>v2</p>", { data: { data: {} }, style: "http://drops.test/droplets/plain/style.css?c=v2" }))));
    markerModule();
    const el = mount(fragment("plain", "<p>v1</p>", { data: { data: {} }, style: "http://drops.test/droplets/plain/style.css?c=v1" }));
    await tick();

    await el.update({ droplet: "plain" });
    const links = el.querySelectorAll<HTMLLinkElement>(":scope > link");
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute("href")).toBe("http://drops.test/droplets/plain/style.css?c=v2");
    expect(el.querySelector(":scope > link[data-droplet-style] + [data-droplet-entry]")).not.toBeNull();
  });

  it("mounts in the browser when the new fragment has no markup (ssr turned off)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => html(fragment("plain", "", { data: { data: { v: 2 } }, ssr: false }))));
    const fake = markerModule();
    const el = mount(fragment("plain", '<h1>v1</h1><div data-droplet-children style="display: contents"></div>', { data: { data: { v: 1 } } }));
    await tick();

    await el.update({ droplet: "plain" });
    expect(el.querySelector("h1")).toBeNull();
    expect(fake.default.mock.calls[1]?.[1]).toBeInstanceOf(Promise);
    expect(((await dataOf(fake, 1)) as unknown as { data: unknown }).data).toEqual({ v: 2 });
  });

  it("swaps the markup of a droplet that does not hydrate", async () => {
    const fetchSpy = vi.fn(async () => html(fragment("clock", "<p>v2</p>")));
    vi.stubGlobal("fetch", fetchSpy);
    const importSpy = vi.fn();
    mod.DjsDropletElement.importModule = importSpy as never;
    const el = mount(fragment("clock", "<p>v1</p>"));
    await tick();

    await el.update({ droplet: "clock" });
    expect(el.querySelector("p")?.textContent).toBe("v2");
    expect(importSpy).not.toHaveBeenCalled();
  });

  it("unmounts and keeps the server markup when hydration is turned off, without reloading", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => html(fragment("plain", "<p>v2</p>"))));
    const fake = markerModule();
    const el = mount(fragment("plain", '<p>v1</p><div data-droplet-children style="display: contents"></div>', { data: { data: {} } }));
    await tick();

    await el.update({ droplet: "plain", hydrate: false });
    expect(fake.unmount).toHaveBeenCalledOnce();
    expect(fake.default).toHaveBeenCalledOnce();
    expect(el.querySelector("p")?.textContent).toBe("v2");

    // Back on, for the tests after this one.
    vi.stubGlobal("fetch", vi.fn(async () => html(fragment("plain", "<p>v3</p>", { data: { data: {} } }))));
    await el.update({ droplet: "plain", hydrate: true });
    expect(fake.default).toHaveBeenCalledTimes(2);
  });

  it("hydrates the error page when the new fragment is one", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => html(fragment("plain", "<p>sorry</p>", { data: { error: { message: "Sorry" } }, error: true }), 500)));
    const fake = markerModule();
    const el = mount(fragment("plain", "<p>v1</p>", { data: { data: {} } }));
    await tick();

    await el.update({ droplet: "plain" });
    expect(el.dataset["dropletError"]).toBe("");
    expect(fake.renderError).toHaveBeenCalledOnce();
    expect(fake.renderError.mock.calls[0]?.[1]).toEqual({ message: "Sorry" });
  });

  it("leaves the droplet as it is when the answer is no fragment", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Unauthorized", { status: 401 })));
    const fake = markerModule();
    const el = mount(fragment("plain", "<p>v1</p>", { data: { data: {} } }));
    await tick();

    await el.update({ droplet: "plain" });
    expect(fake.unmount).not.toHaveBeenCalled();
    expect(el.querySelector("p")?.textContent).toBe("v1");
    expect(String(error.mock.calls[0]?.[0])).toContain("plain: could not fetch the fragment again");
  });

  it("mounts an element the host wrote in the browser again, without asking for a fragment", async () => {
    const fetchSpy = vi.fn(async () => json({ data: {} }));
    vi.stubGlobal("fetch", fetchSpy);
    const fake = markerModule();
    const el = mount(`<djs-droplet data-droplet="hello" data-params='{"page":1}'></djs-droplet>`);
    await tick();
    await tick();

    await el.update({ droplet: "hello" });
    const urls = fetchSpy.mock.calls.map((call) => String((call as unknown as [string])[0]));
    expect(urls.every((url) => url.includes("/_data"))).toBe(true);
    expect(fake.default).toHaveBeenCalledTimes(2);
    expect(fake.default.mock.calls[1]?.[1]).toBeInstanceOf(Promise);
  });
});

describe("lazy hydrate", () => {
  /** An `IntersectionObserver` the test drives: `enter()` reports the element in view. */
  function fakeObserver() {
    const made: Array<{ target: Element | null; options: IntersectionObserverInit | undefined; disconnected: boolean; enter: () => void }> = [];
    class Observer {
      record: (typeof made)[number];
      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        this.record = {
          target: null,
          options,
          disconnected: false,
          enter: () => callback([{ isIntersecting: true } as IntersectionObserverEntry], this as never),
        };
        made.push(this.record);
      }
      observe(target: Element) {
        this.record.target = target;
      }
      disconnect() {
        this.record.disconnected = true;
      }
    }
    vi.stubGlobal("IntersectionObserver", Observer);
    return made;
  }
  const withSlot = (html: string) => `${html}<div data-droplet-slot><button id="kid">kid</button></div></djs-droplet>`;

  it("interactive: loads nothing until the first interaction with its own markup", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const fake = markerModule();
    const el = mount(withSlot(ssrWithMarker("plain", ' data-hydrate="interactive"')));
    await tick();
    expect(mod.DjsDropletElement.importModule).not.toHaveBeenCalled();

    // The host's children are not the droplet's markup.
    el.querySelector("#kid")!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    await tick();
    expect(mod.DjsDropletElement.importModule).not.toHaveBeenCalled();

    el.querySelector("h1")!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    await tick();
    expect(mod.DjsDropletElement.importModule).toHaveBeenCalledOnce();
    expect(fake.default).toHaveBeenCalledOnce();
    expect(fake.default.mock.calls[0]?.[1]).not.toBeInstanceOf(Promise);
  });

  it("interactive without server markup mounts at once", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const fake = markerModule();
    mount('<djs-droplet data-droplet="plain" data-hydrate="interactive"></djs-droplet>');
    await tick();
    expect(fake.default).toHaveBeenCalledOnce();
  });

  it("visible: loads as it is about to scroll into view, starting earlier without server markup", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const observers = fakeObserver();
    const fake = markerModule();
    const el = mount(withSlot(ssrWithMarker("plain", ' data-hydrate="visible"')));
    await tick();
    expect(observers).toHaveLength(1);
    expect(observers[0]?.target).toBe(el);
    expect(observers[0]?.options?.rootMargin).toBe("200px");
    expect(mod.DjsDropletElement.importModule).not.toHaveBeenCalled();

    observers[0]!.enter();
    await tick();
    expect(observers[0]?.disconnected).toBe(true);
    expect(fake.default).toHaveBeenCalledOnce();

    mount('<djs-droplet data-droplet="plain" data-hydrate="visible"></djs-droplet>');
    await tick();
    expect(observers[1]?.options?.rootMargin).toBe("1000px");
  });

  it("stops waiting when the element leaves", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const observers = fakeObserver();
    markerModule();
    const el = mount(ssrWithMarker("plain", ' data-hydrate="visible"') + "</djs-droplet>");
    await tick();
    el.remove();
    await tick();
    expect(observers[0]?.disconnected).toBe(true);
    observers[0]!.enter();
    await tick();
    expect(mod.DjsDropletElement.importModule).not.toHaveBeenCalled();
  });

  it("lets the host turn hydration off, and warns about a value it does not know", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const fake = markerModule();
    const el = mount(withSlot(ssrWithMarker("plain", ' data-hydrate="false"')));
    await tick();
    expect(mod.DjsDropletElement.importModule).not.toHaveBeenCalled();
    expect(el.querySelector("h1")?.textContent).toBe("ssr");
    expect(filledIn(el)?.querySelector("#kid")).not.toBeNull();

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mount(ssrWithMarker("plain", ' data-hydrate="idle"') + "</djs-droplet>");
    await tick();
    expect(String(warn.mock.calls[0]?.[0])).toContain('data-hydrate="idle": use true, false, visible or interactive');
    expect(fake.default).toHaveBeenCalledOnce();
  });
});

describe("what the dev tool sees", () => {
  const stateOf = (el: HTMLElement) => devClass().devElements().find((info) => info.element === el);

  it("lists the connected elements in document order, with where each one is", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ data: {} })));
    markerModule();
    const waiting = mount(ssrWithMarker("plain", ' data-hydrate="interactive"') + "</djs-droplet>");
    const hydrated = mount(ssrWithMarker("plain") + "</djs-droplet>");
    const fixed = mount('<djs-droplet data-droplet="clock"><div data-droplet-entry><p>1</p></div></djs-droplet>');
    const mounted = mount(`<djs-droplet data-droplet="hello" data-params='{"page":1}'></djs-droplet>`);
    await tick();
    await tick();

    expect(devClass().devElements().map((info) => info.element)).toEqual([waiting, hydrated, fixed, mounted]);
    expect(stateOf(waiting)).toMatchObject({ droplet: "plain", state: "waiting", hydrate: "interactive", changed: false });
    expect(stateOf(hydrated)).toMatchObject({ state: "hydrated", hydrate: true });
    expect(stateOf(fixed)).toMatchObject({ state: "static", hydrate: false });
    expect(stateOf(mounted)).toMatchObject({ state: "mounted" });

    hydrated.remove();
    await tick();
    expect(stateOf(hydrated)).toBeUndefined();
  });
});
