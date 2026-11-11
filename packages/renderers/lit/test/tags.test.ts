import { LitElement } from "lit";
import { describe, expect, it } from "vitest";
import { adoptTag, claimTag, tagName, type Registry } from "../src/tags.ts";

describe("tags", () => {
  it("names a droplet's element after the prefix, its error page with --error", () => {
    expect(tagName({ prefix: "djs-shop", droplet: "cart", kind: "droplet" })).toBe("djs-shop-cart");
    expect(tagName({ prefix: "djs-shop", droplet: "static-note", kind: "error" })).toBe("djs-shop-static-note--error");
    expect(tagName({ prefix: "lit", droplet: "2fa", kind: "droplet" })).toBe("lit-2fa");
    expect(() => tagName({ prefix: "djs-shop", droplet: "café au lait", kind: "droplet" })).toThrow(/not a valid custom element name/);
  });

  /** A registry as the page's: one class per name, one name per class. */
  function registry(): Registry & { names: Map<string, CustomElementConstructor> } {
    const names = new Map<string, CustomElementConstructor>();
    return {
      names,
      get: (name) => names.get(name),
      define(name, element) {
        if (names.has(name)) throw new Error(`"${name}" has already been used with this registry`);
        if ([...names.values()].includes(element)) throw new Error("this constructor has already been used with this registry");
        names.set(name, element);
      },
      getName: (element) => [...names].find(([, c]) => c === element)?.[0] ?? null,
    };
  }
  // A custom element is a class.
  function element(): CustomElementConstructor {
    return class extends LitElement {} as unknown as CustomElementConstructor;
  }

  it("defines a class once, and a second class for the same name under --v2", () => {
    const page = registry();
    const first = element();
    expect(claimTag({ registry: page, component: first, tag: "djs-shop-cart" })).toBe("djs-shop-cart");
    expect(claimTag({ registry: page, component: first, tag: "djs-shop-cart" })).toBe("djs-shop-cart");
    // The same module evaluated again after an edit, in vite dev.
    const edited = element();
    expect(claimTag({ registry: page, component: edited, tag: "djs-shop-cart" })).toBe("djs-shop-cart--v2");
    expect(claimTag({ registry: page, component: element(), tag: "djs-shop-cart" })).toBe("djs-shop-cart--v3");
    expect([...page.names.keys()]).toEqual(["djs-shop-cart", "djs-shop-cart--v2", "djs-shop-cart--v3"]);
  });

  it("keeps the name a class defined itself", () => {
    const page = registry();
    const own = element();
    page.define("x-own", own);
    expect(claimTag({ registry: page, component: own, tag: "djs-shop-own" })).toBe("x-own");
  });

  it("adopts markup only under the class's own name", () => {
    const page = registry();
    const cart = element();
    expect(adoptTag({ registry: page, component: cart, tag: "djs-shop-cart" })).toBe(true);
    expect(adoptTag({ registry: page, component: cart, tag: "djs-shop-cart" })).toBe(true);
    // Another class holds the name: another server with the same element, or an edit.
    expect(adoptTag({ registry: page, component: element(), tag: "djs-shop-cart" })).toBe(false);
    // Defined under another name already: that markup is not its.
    const mounted = element();
    claimTag({ registry: page, component: mounted, tag: "djs-shop-list" });
    expect(adoptTag({ registry: page, component: mounted, tag: "djs-shop-list--v9" })).toBe(false);
  });
});
