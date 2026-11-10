import { existsSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { readExportedFlags, validateRenderers } from "@dropletsjs/droplets";
import type { ServerRenderContext } from "@dropletsjs/droplets";
import { css, html, LitElement } from "lit";
import { lit } from "../src/index.ts";
import { litPlugin, PREFIX_MODULE, SERVER_BUNDLED, serverBuildOf } from "../src/plugin.ts";
import { renderComponent } from "../src/render.ts";
import { adoptTag, claimTag, tagName, type Registry } from "../src/tags.ts";

describe("lit()", () => {
  it("claims .lit.ts and .lit.js and points at its built modules", () => {
    const renderer = lit();
    expect(renderer.name).toBe("lit");
    expect(renderer.extensions).toEqual([".lit.ts", ".lit.js"]);
    const byExtension = validateRenderers([renderer]);
    expect(byExtension.get(".lit.ts")).toEqual([renderer]);
    expect(renderer.server).toMatch(/[\\/]dist[\\/]server\.js$/);
    expect(renderer.client).toMatch(/[\\/]dist[\\/]client\.js$/);
    expect(renderer.clientSetup).toMatch(/[\\/]dist[\\/]client-setup\.js$/);
    expect(existsSync(renderer.server), "build the package first").toBe(true);
    expect(existsSync(renderer.client)).toBe(true);
    expect(existsSync(renderer.clientSetup!)).toBe(true);
    expect(renderer.packages).toContain("lit");
    expect(renderer.packages).toContain("@dropletsjs/renderer-lit");
    expect(renderer.componentTypes).toBe("@dropletsjs/renderer-lit");
    expect(renderer.plugins).toHaveLength(1);
  });

  it("sits next to the renderers that claim .ts-like suffixes: .ts stays core's", () => {
    const tsx = { name: "react", extensions: [".tsx"], packages: ["react"], server: "/s.js", client: "/c.js" };
    expect(() => validateRenderers([lit(), tsx])).not.toThrow();
  });

  it("refuses a prefix that cannot start a custom element name", () => {
    expect(() => lit({ prefix: "My Shop" })).toThrow(/must start with a lowercase letter/);
    expect(() => lit({ prefix: "shop" })).not.toThrow();
  });

  it("reads flags from the component's named exports with the default reader", () => {
    const source = `import { LitElement } from "lit";\nexport const ssr = false;\nexport const hydrate = "visible";\nexport default class X extends LitElement {}\n`;
    expect(readExportedFlags(source, "hello")).toEqual({ ssr: false, hydrate: "visible" });
  });
});

describe("tags", () => {
  it("names a droplet's element after the prefix, its error page with --error", () => {
    expect(tagName("djs-shop", "cart", "droplet")).toBe("djs-shop-cart");
    expect(tagName("djs-shop", "static-note", "error")).toBe("djs-shop-static-note--error");
    expect(tagName("lit", "2fa", "droplet")).toBe("lit-2fa");
    expect(() => tagName("djs-shop", "café au lait", "droplet")).toThrow(/not a valid custom element name/);
  });

  /** A registry as the page's: one class per name, one name per class. */
  function registry(): Registry & { names: Map<string, CustomElementConstructor> } {
    const names = new Map<string, CustomElementConstructor>();
    return {
      names,
      get: (name) => names.get(name),
      define(name, constructor) {
        if (names.has(name)) throw new Error(`"${name}" has already been used with this registry`);
        if ([...names.values()].includes(constructor)) throw new Error("this constructor has already been used with this registry");
        names.set(name, constructor);
      },
      getName: (constructor) => [...names].find(([, c]) => c === constructor)?.[0] ?? null,
    };
  }
  const element = () => class extends LitElement {} as unknown as CustomElementConstructor;

  it("defines a class once, and a second class for the same name under --v2", () => {
    const page = registry();
    const first = element();
    expect(claimTag(page, first, "djs-shop-cart")).toBe("djs-shop-cart");
    expect(claimTag(page, first, "djs-shop-cart")).toBe("djs-shop-cart");
    // The same module evaluated again after an edit, in vite dev.
    const edited = element();
    expect(claimTag(page, edited, "djs-shop-cart")).toBe("djs-shop-cart--v2");
    expect(claimTag(page, element(), "djs-shop-cart")).toBe("djs-shop-cart--v3");
    expect([...page.names.keys()]).toEqual(["djs-shop-cart", "djs-shop-cart--v2", "djs-shop-cart--v3"]);
  });

  it("keeps the name a class defined itself", () => {
    const page = registry();
    const own = element();
    page.define("x-own", own);
    expect(claimTag(page, own, "djs-shop-own")).toBe("x-own");
  });

  it("adopts markup only under the class's own name", () => {
    const page = registry();
    const cart = element();
    expect(adoptTag(page, cart, "djs-shop-cart")).toBe(true);
    expect(adoptTag(page, cart, "djs-shop-cart")).toBe(true);
    // Another class holds the name: another server with the same element, or an edit.
    expect(adoptTag(page, element(), "djs-shop-cart")).toBe(false);
    // Defined under another name already: that markup is not its.
    const mounted = element();
    claimTag(page, mounted, "djs-shop-list");
    expect(adoptTag(page, mounted, "djs-shop-list--v9")).toBe(false);
  });
});

describe("the server render", () => {
  const context = (kind: "droplet" | "error" = "droplet"): ServerRenderContext => ({
    droplet: "hello",
    kind,
    renderId: "abc123",
    actionUrl: (name) => `https://shop.test/droplets/hello${name ? `?/${name}` : ""}`,
  });

  class Hello extends LitElement {
    static override properties = { data: { attribute: false }, form: { attribute: false }, actionUrl: { attribute: false } };
    static override styles = css`h1 { color: teal; }`;
    declare data: { greeting: string };
    declare form: { message: string } | undefined;
    declare actionUrl: (name?: string) => string;
    override render() {
      return html`<h1>${this.data.greeting}</h1><p>${this.form?.message ?? "none"}</p><form action=${this.actionUrl("add")}></form><slot></slot>`;
    }
  }

  class HelloError extends LitElement {
    static override properties = { error: { attribute: false } };
    declare error: { message: string };
    override render() {
      return html`<p>${this.error.message}</p>`;
    }
  }

  const text = (html: string) => html.replace(/<!--[^>]*-->/g, "");

  it("prints a deferred element with its shadow root as a declarative template, the marker in light DOM", async () => {
    const out = await renderComponent({ default: Hello }, { data: { greeting: "Hi <b>Ana</b>" } }, context(), "test-lit");
    expect(out).toMatch(/^<!--lit-part [^>]+--><!--lit-node 0--><test-lit-hello\s+defer-hydration><template shadowroot="open" shadowrootmode="open">/);
    // Styles travel inside the shadow root.
    expect(out).toContain("<style>h1 { color: teal; }</style>");
    // Data is escaped, never markup.
    expect(text(out)).toContain("<h1>Hi &lt;b&gt;Ana&lt;/b&gt;</h1><p>none</p>");
    expect(out).toContain('<form action="https://shop.test/droplets/hello?/add">');
    expect(out).toMatch(/<\/template><div data-droplet-children style="display: contents"><\/div><\/test-lit-hello><!--\/lit-part-->$/);
  });

  it("passes the form action's result as `form`", async () => {
    const out = await renderComponent({ default: Hello }, { data: { greeting: "Hi" }, form: { message: "Thanks" } }, context(), "test-lit");
    expect(text(out)).toContain("<p>Thanks</p>");
  });

  it("renders an error page as its own element, with `error`", async () => {
    const out = await renderComponent({ default: HelloError }, { error: { message: "Sorry" } }, context("error"), "test-lit");
    expect(out).toContain("<test-lit-hello--error");
    expect(text(out)).toContain("<p>Sorry</p>");
  });

  it("says what a component file must export", async () => {
    await expect(renderComponent({ default: () => "<p>" }, { data: {} }, context(), "test-lit")).rejects.toThrow(
      /must default-export a LitElement class/,
    );
    await expect(renderComponent({}, { data: {} }, context(), "test-lit")).rejects.toThrow(/LitElement class/);
  });

  it("renders an edited class under a tag of its own, never redefining one", async () => {
    class Edited extends Hello {}
    const out = await renderComponent({ default: Edited }, { data: { greeting: "Hi" } }, context(), "test-lit");
    expect(out).toContain("<test-lit-hello--v2");
  });
});

describe("the Vite plugin", () => {
  it("swaps the browser builds of lit-html and @lit/reactive-element for their server twins", () => {
    const all = () => true;
    const base = "/repo/node_modules/.pnpm/lit-html@3.3.3/node_modules/lit-html";
    expect(serverBuildOf(`${base}/lit-html.js`, all)).toBe(`${base}/node/lit-html.js`);
    expect(serverBuildOf(`${base}/development/directive.js`, all)).toBe(`${base}/node/development/directive.js`);
    expect(serverBuildOf(`${base}/node/lit-html.js`, all)).toBeNull();
    expect(serverBuildOf("/repo/node_modules/@lit/reactive-element/css-tag.js", all)).toBe(
      "/repo/node_modules/@lit/reactive-element/node/css-tag.js",
    );
    expect(serverBuildOf("/repo/node_modules/lit-element/lit-element.js", all)).toBeNull();
    expect(serverBuildOf(`${base}/lit-html.js`, () => false)).toBeNull();
  });

  it("bundles Lit into server builds only", () => {
    const plugin = litPlugin();
    const configEnvironment = plugin.configEnvironment as (name: string, config: { consumer?: string }) => unknown;
    expect(configEnvironment("client", {})).toBeUndefined();
    expect(configEnvironment("ssr", {})).toEqual({ resolve: { noExternal: SERVER_BUNDLED } });
    expect(configEnvironment("server", { consumer: "server" })).toEqual({ resolve: { noExternal: SERVER_BUNDLED } });
  });

  it("takes the prefix from the droplets element, or from the option", () => {
    const fromCore = litPlugin();
    (fromCore.configResolved as (config: unknown) => void)({ plugins: [{ name: "droplets", api: { element: () => "djs-shop" } }] });
    const load = (plugin: ReturnType<typeof litPlugin>) => (plugin.load as (id: string) => string | null)(`\0${PREFIX_MODULE}`);
    expect(load(fromCore)).toBe('export const prefix = "djs-shop";\n');

    const given = litPlugin({ prefix: "shop-ui" });
    (given.configResolved as (config: unknown) => void)({ plugins: [{ name: "droplets", api: { element: vi.fn(() => "x-y") } }] });
    expect(load(given)).toBe('export const prefix = "shop-ui";\n');
  });
});
