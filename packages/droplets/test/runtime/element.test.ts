import { describe, expect, it } from "vitest";
import { dropletElement } from "../../src/runtime/element.ts";

const base = {
  element: "djs-droplet",
  droplet: "hello",
  dropletData: "",
  html: "<p>hi</p>",
};

describe("dropletElement", () => {
  it("wraps the SSR output in a <djs-droplet> with its origin", async () => {
    const out = String(await dropletElement(base));
    expect(out).toBe(
      '<djs-droplet data-droplet="hello">' + '<div style="display: contents" data-droplet-entry><p>hi</p></div></djs-droplet>',
    );
  });

  it("inlines context and data payloads as text scripts", async () => {
    const out = String(await dropletElement({ ...base, dropletContext: "Y3R4", dropletData: "ZGF0YQ==" }));
    expect(out).toContain('<script type="application/text" data-droplet-payload="context">Y3R4</script>');
    expect(out).toContain('<script type="application/text" data-droplet-payload="data">ZGF0YQ==</script>');
  });

  it("stamps the build and marks error pages", async () => {
    const out = String(await dropletElement({ ...base, build: "abc123", error: true }));
    expect(out.startsWith('<djs-droplet data-droplet="hello" data-droplet-build="abc123" data-droplet-error>')).toBe(true);
    expect(String(await dropletElement(base))).not.toContain("data-droplet-error");
  });

  it("uses the configured element name", async () => {
    const out = String(await dropletElement({ ...base, element: "acme-widget" }));
    expect(out.startsWith('<acme-widget data-droplet="hello"')).toBe(true);
    expect(out.endsWith("</acme-widget>")).toBe(true);
    expect(out).not.toContain("djs-droplet");
  });

  it("puts the context on an attribute when asked", async () => {
    const out = String(await dropletElement({ ...base, contextAttr: "Y3R4" }));
    expect(out).toContain(' data-droplet-context="Y3R4"');
    expect(out).not.toContain('data-droplet-payload="context"');
  });

  it("links the stylesheet inside the element, right before the content root, escaped", async () => {
    const out = String(await dropletElement({ ...base, stylesheet: 'http://x.test/droplets/hello/style.css?c=1&"' }));
    expect(out).toContain(
      '<link rel="stylesheet" href="http://x.test/droplets/hello/style.css?c=1&amp;&quot;" data-droplet-style><div style="display: contents" data-droplet-entry>',
    );
    expect(String(await dropletElement(base))).not.toContain("<link");
  });

  it("escapes attribute values but not the rendered HTML", async () => {
    const out = String(
      await dropletElement({
        ...base,
        build: '1"><script>',
        html: "<b>bold</b>",
      }),
    );
    expect(out).toContain('data-droplet-build="1&quot;&gt;&lt;script&gt;"');
    expect(out).toContain("<b>bold</b>");
  });

  it("writes data-droplet and data-droplet-* attributes, nothing else", async () => {
    const out = String(
      await dropletElement({
        ...base,
        dropletContext: "Y3R4",
        dropletData: "ZGF0YQ==",
        contextAttr: "Y3R4",
        build: "abc123",
        renderId: "r1",
        error: true,
        stylesheet: "http://x.test/droplets/hello/style.css",
      }),
    );
    const names = Array.from(out.matchAll(/<[a-z-]+((?:\s+[^\s=>]+(?:="[^"]*")?)*)\s*>/g), (tag) =>
      Array.from(tag[1]?.matchAll(/\s([^\s=>]+)/g) ?? [], (attribute) => attribute[1]),
    ).flat();
    expect(names.filter((name) => name?.startsWith("data-")).sort()).toEqual([
      "data-droplet",
      "data-droplet-build",
      "data-droplet-context",
      "data-droplet-entry",
      "data-droplet-error",
      "data-droplet-payload",
      "data-droplet-payload",
      "data-droplet-render",
      "data-droplet-style",
    ]);
    expect(names.every((name) => !name?.startsWith("data-") || name === "data-droplet" || name.startsWith("data-droplet-"))).toBe(true);
  });

  it("never says where the droplet loads from: the browser takes that from /index.js", async () => {
    expect(String(await dropletElement(base))).not.toContain("location");
  });
});
