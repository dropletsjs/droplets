import { describe, expect, it } from "vitest";
import {
  actionHref,
  actionUrlFor,
  backUrl,
  browserPage,
  currentRender,
  formResultKey,
  isReservedQueryKey,
  splitFormResults,
  withoutFormResults,
  withRender,
} from "../../src/runtime/form.ts";

describe("actionHref", () => {
  it("names the action, default without one", () => {
    expect(actionHref("https://drops.test", "cart", {})).toBe("https://drops.test/droplets/cart");
    expect(actionHref("https://drops.test", "cart", {}, "add")).toBe("https://drops.test/droplets/cart?/add");
    expect(actionHref("https://drops.test", "cart", {}, "default")).toBe("https://drops.test/droplets/cart");
  });

  it("keeps the location's path prefix, without a trailing slash; relative without a location", () => {
    expect(actionHref("https://shop.test/mfe/", "cart", {}, "add")).toBe("https://shop.test/mfe/droplets/cart?/add");
    expect(actionHref("", "cart", {}, "add")).toBe("/droplets/cart?/add");
  });

  it("carries the primitive props, encoded, never a reserved key", () => {
    const props = {
      productId: "a b&c",
      page: 2,
      open: true,
      tags: ["x"],
      nested: { a: 1 },
      none: null,
      c: "build",
      "/add": "x",
      __droplet_form_cart_b1: "forged",
      __droplet_return: "https://evil.example/",
    };
    expect(actionHref("https://drops.test", "cart", props, "add")).toBe(
      "https://drops.test/droplets/cart?/add&productId=a%20b%26c&page=2&open=true",
    );
  });

  it("names the page as __droplet_return, last and encoded; a prop by that name never replaces it", () => {
    const page = "https://shop.test/p/caf%C3%A9";
    expect(actionHref("https://drops.test", "cart", { __droplet_return: "https://evil.example/" }, "add", page)).toBe(
      "https://drops.test/droplets/cart?/add&__droplet_return=https%3A%2F%2Fshop.test%2Fp%2Fcaf%25C3%25A9",
    );
    expect(new URL(actionHref("https://drops.test", "cart", { page: 2 }, undefined, page)).searchParams.getAll("__droplet_return"))
      .toEqual([page]);
    // Without a page, none.
    expect(actionHref("https://drops.test", "cart", {}, "add", "")).toBe("https://drops.test/droplets/cart?/add");
  });

  it("refuses a name actions cannot export", () => {
    for (const name of ["", "a b", "a&b", "../x", "1st", "a?b"]) {
      expect(() => actionHref("https://drops.test", "cart", {}, name), name).toThrow(/is not an action name/);
    }
  });

  it("encodes the droplet id", () => {
    expect(actionHref("https://drops.test", "a/b", {})).toBe("https://drops.test/droplets/a%2Fb");
  });

  it("is what actionUrlFor gives a render", () => {
    const actionUrl = actionUrlFor("https://drops.test", "cart", { page: 1 });
    expect(actionUrl()).toBe("https://drops.test/droplets/cart?page=1");
    expect(actionUrl("add")).toBe("https://drops.test/droplets/cart?/add&page=1");
    expect(actionUrlFor("https://drops.test", "cart", {}, "https://shop.test/")("add")).toBe(
      "https://drops.test/droplets/cart?/add&__droplet_return=https%3A%2F%2Fshop.test%2F",
    );
  });

  it("reads the browser's page from window.location, web pages only", () => {
    const global = globalThis as { location?: unknown };
    const saved = Object.getOwnPropertyDescriptor(globalThis, "location");
    try {
      Object.defineProperty(globalThis, "location", {
        configurable: true,
        value: { protocol: "https:", origin: "https://shop.test", pathname: "/p/1", search: "?q=1", hash: "#x" },
      });
      expect(browserPage()).toBe("https://shop.test/p/1");
      Object.defineProperty(globalThis, "location", { configurable: true, value: { protocol: "about:", origin: "null", pathname: "blank" } });
      expect(browserPage()).toBeUndefined();
      Object.defineProperty(globalThis, "location", { configurable: true, value: undefined });
      expect(browserPage()).toBeUndefined();
    } finally {
      if (saved) Object.defineProperty(globalThis, "location", saved);
      else delete global.location;
    }
  });
});

describe("reserved query keys", () => {
  it("covers the framework's keys, action names and the no-JS result prefix", () => {
    for (const key of ["c", "t", "__cb", "noSSR", "clientOnly", "/add", "__droplet_form_cart_b1", "__droplet_return"]) {
      expect(isReservedQueryKey(key), key).toBe(true);
    }
    // `noJS` is gone: a key like any other.
    for (const key of ["page", "noJS"]) expect(isReservedQueryKey(key), key).toBe(false);
  });
});

describe("withRender", () => {
  it("holds the render while the callback runs, and restores what was there", () => {
    expect(currentRender()).toBeUndefined();
    const outer = { droplet: "a", location: "https://drops.test" };
    withRender(outer, () => {
      expect(currentRender()).toBe(outer);
      expect(() =>
        withRender({ droplet: "b", location: "" }, () => {
          throw new Error("boom");
        })
      ).toThrow("boom");
      expect(currentRender()).toBe(outer);
    });
    expect(currentRender()).toBeUndefined();
  });
});

describe("no-JavaScript results in a URL", () => {
  it("keys a result by droplet and build", () => {
    expect(formResultKey("product-page", "abc123")).toBe("__droplet_form_product-page_abc123");
    expect(isReservedQueryKey(formResultKey("cart", "x"))).toBe(true);
  });

  it("takes every __droplet_form_* key out, encoded ones too, and leaves the rest as written", () => {
    const url = new URL("https://shop.test/p?a=1&__droplet_form_cart_b1=v.1&b=x%20y+z&%5F%5Fdroplet_form_page_b1=v.2&c#h");
    const { url: rest, results } = splitFormResults(url);
    expect(rest.href).toBe("https://shop.test/p?a=1&b=x%20y+z&c#h");
    expect([...results]).toEqual([["__droplet_form_cart_b1", "v.1"], ["__droplet_form_page_b1", "v.2"]]);
    // A copy: the URL given is left alone.
    expect(url.search).toContain("__droplet_form_cart_b1");
    expect(withoutFormResults(new URL("https://shop.test/p?__droplet_form_x_1=y")).href).toBe("https://shop.test/p");
    expect(withoutFormResults(new URL("https://shop.test/p?q=%E2%9C%93")).href).toBe("https://shop.test/p?q=%E2%9C%93");
  });

  it("takes __droplet_return out of a page too, never as a result", () => {
    const { url, results } = splitFormResults(new URL("https://shop.test/p?a=1&__droplet_return=https%3A%2F%2Fx&%5F%5Fdroplet_return=y"));
    expect(url.href).toBe("https://shop.test/p?a=1");
    expect(results.size).toBe(0);
  });

  it("goes back to a page without action names, the framework's keys or a hash", () => {
    const page = new URL("https://shop.test/p?/add&a=1&%2Fleave=&__droplet_return=x&__droplet_form_cart_b1=v.1&%2F%E0=&b=x%20y#top");
    expect(backUrl(page).href).toBe("https://shop.test/p?a=1&b=x%20y");
    expect(backUrl(new URL("https://shop.test/p?/add")).href).toBe("https://shop.test/p");
  });
});
