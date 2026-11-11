import { describe, expect, it } from "vitest";
import { renderDevtoolsPage, withPageStyles } from "../src/page.tsx";

describe("renderDevtoolsPage", () => {
  it("inlines the data and the import map safely", () => {
    const html = renderDevtoolsPage({
      element: "acme-widget",
      droplets: [{ id: "x</script>", folder: "x", ssr: true, hydrate: true, hasLoad: false, hasServerLoad: false }],
      importMap: '<script type="importmap">{"imports":{"lib":"https://cdn.test/lib.js"}}</script>',
      loaderUrl: "/index.js",
      clientUrl: "/@fs/x/devtools.js",
    });
    expect(html).toContain('<script type="importmap">{"imports":{"lib":"https://cdn.test/lib.js"}}</script>');
    expect(html).toContain("&lt;acme-widget&gt;");
    expect(html).not.toContain("x</script>");
    expect(html).toContain('<script type="module" vite-ignore="true" src="/index.js?injectTool=true"></script>');
  });

  it("leaves the import map out when there is none", () => {
    const html = renderDevtoolsPage({ element: "a-b", droplets: [], loaderUrl: "/index.js", clientUrl: "/c.js" });
    expect(html).not.toContain("importmap");
  });

  it("leaves its own styles to withPageStyles when asked", () => {
    const html = renderDevtoolsPage({ element: "a-b", droplets: [], loaderUrl: "/index.js", clientUrl: "/c.js", pageStyles: false });
    expect(html).not.toContain("<style>");
    expect(withPageStyles({ html })).toMatch(/<style>[^<]*--dt-panel: #ffffff;[^<]*<\/style><\/head>/);
  });
});
