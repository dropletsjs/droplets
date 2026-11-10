// @vitest-environment happy-dom
import Handlebars from "handlebars";
import type { ClientRenderContext } from "@dropletsjs/droplets";
import { describe, expect, it, vi } from "vitest";
import { hydrate, markersIn, mount, unmount } from "../src/client.ts";
import { env } from "../src/runtime.ts";

/** A template as the plugin would ship it: precompiled, on the renderer's environment. */
const compile = (source: string) => ({
  default: env.template(new Function(`return ${Handlebars.precompile(source) as unknown as string}`)() as never),
});

function context(kind: ClientRenderContext["kind"] = "droplet", markers: Element[] = []) {
  const ctx = {
    droplet: "hello",
    kind,
    renderId: "r1",
    children: { fill: vi.fn(), empty: vi.fn() },
    markers: () => markers,
    actionUrl: () => "/droplets/hello",
  } satisfies ClientRenderContext;
  return ctx;
}

const hello = compile('<h1>{{data.greeting}}</h1><div data-testid="children">{{{children}}}</div><i>{{@renderId}}</i>');

describe("mount", () => {
  it("renders the template into the target and hands the marker to the host", async () => {
    const target = document.createElement("div");
    document.body.appendChild(target);
    const ctx = context();
    const instance = await mount(hello, target, { data: { greeting: "Hi" } }, ctx);
    expect(target.innerHTML).toBe('<h1>Hi</h1><div data-testid="children"><div data-droplet-children="" style="display: contents"></div></div><i>r1</i>');
    const marker = target.querySelector("[data-droplet-children]");
    expect(ctx.children.fill).toHaveBeenCalledWith(marker);
    expect(ctx.children.fill).toHaveBeenCalledTimes(1);

    const connected: boolean[] = [];
    ctx.children.empty.mockImplementation((m: Element) => connected.push(m.isConnected));
    unmount(instance);
    // Emptied before the HTML went.
    expect(ctx.children.empty).toHaveBeenCalledWith(marker);
    expect(connected).toEqual([true]);
    expect(target.innerHTML).toBe("");
    target.remove();
  });

  it("renders an error page with { error }", async () => {
    const target = document.createElement("div");
    const page = compile('<p data-testid="error">{{error.message}}</p>');
    await mount(page, target, { error: { message: "Oops" } }, context("error"));
    expect(target.innerHTML).toBe('<p data-testid="error">Oops</p>');
  });

  it("waits for data that is a promise before rendering", async () => {
    const target = document.createElement("div");
    const pending = mount(hello, target, { data: Promise.resolve({ greeting: "Later" }) }, context());
    expect(target.innerHTML).toBe("");
    await pending;
    expect(target.querySelector("h1")?.textContent).toBe("Later");
  });

  it("renders the error page in place when data rejects, through handle", async () => {
    const target = document.createElement("div");
    const page = compile('<p data-testid="error">{{error.message}} ({{@kind}})</p>');
    const handle = vi.fn(async (error: unknown) => ({ message: `handled ${(error as Error).message}` }));
    const ctx = { ...context(), error: { module: page, handle } };
    await mount(hello, target, { data: Promise.reject(new Error("boom")) }, ctx);
    expect(target.innerHTML).toBe('<p data-testid="error">handled boom (error)</p>');

    // handle rejects: nothing to show.
    const nothing = document.createElement("div");
    const refusing = { ...context(), error: { module: page, handle: vi.fn(async () => Promise.reject(new Error("no"))) } };
    await mount(hello, nothing, { data: Promise.reject(new Error("boom")) }, refusing);
    expect(nothing.innerHTML).toBe("");
    // No error page: the rejection is the caller's.
    await expect(mount(hello, document.createElement("div"), { data: Promise.reject(new Error("boom")) }, context()))
      .rejects.toThrow("boom");
  });

  it("throws a clear error for a module without a template", async () => {
    await expect(mount({}, document.createElement("div"), { data: {} }, context())).rejects.toThrow(
      "hello: +droplet.hbs did not compile to a template function",
    );
  });
});

describe("hydrate", () => {
  it("keeps the server DOM and fills the server's markers", () => {
    const target = document.createElement("div");
    target.innerHTML = '<h1>Hi</h1><div data-testid="children"><div data-droplet-children style="display: contents"></div></div>';
    const h1 = target.querySelector("h1");
    const marker = target.querySelector("[data-droplet-children]")!;
    const ctx = context("droplet", [marker]);

    const instance = hydrate(hello, target, { data: { greeting: "Other" } }, ctx);
    expect(target.querySelector("h1")).toBe(h1);
    expect(target.querySelector("h1")?.textContent).toBe("Hi");
    expect(target.querySelector("[data-droplet-children]")).toBe(marker);
    expect(ctx.children.fill).toHaveBeenCalledWith(marker);

    unmount(instance);
    expect(ctx.children.empty).toHaveBeenCalledWith(marker);
    expect(target.childNodes).toHaveLength(0);
  });

  it("finds the markers itself when the context lists none", () => {
    const target = document.createElement("div");
    target.innerHTML = '<div><div data-droplet-children style="display: contents"></div></div>';
    const ctx = context();
    hydrate(hello, target, { data: {} }, ctx);
    expect(ctx.children.fill).toHaveBeenCalledWith(target.querySelector("[data-droplet-children]"));
  });
});

describe("markersIn", () => {
  it("skips the markers of a droplet nested in the markup", () => {
    const host = document.createElement("test-droplet");
    host.setAttribute("data-droplet", "outer");
    const target = document.createElement("div");
    host.appendChild(target);
    target.innerHTML = '<div data-droplet-children id="mine"></div><test-droplet data-droplet="inner"><div data-droplet-children id="theirs"></div></test-droplet>';
    expect(markersIn(target).map((s) => s.id)).toEqual(["mine"]);
  });
});
