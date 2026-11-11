import postcss from "postcss";
import { describe, expect, it } from "vitest";
import { type ScopeStylesOptions, scopeSelector, scopeStylesPlugin } from "../../src/css/scope.ts";

const el = "my-droplet";

describe("scopeSelector", () => {
  it.each([
    [".p-4", "my-droplet .p-4"],
    ["*", "my-droplet *"],
    ["*, ::before, ::after", "my-droplet *, my-droplet ::before, my-droplet ::after"],
    ["h1, h2", "my-droplet h1, my-droplet h2"],
    [".a > .b + .c", "my-droplet .a > .b + .c"],
    [":root", "my-droplet"],
    [":root, :host", "my-droplet, my-droplet"],
    [":host(.dark)", "my-droplet"],
    ["html", "my-droplet"],
    ["body", "my-droplet"],
    ["html body .x", "my-droplet .x"],
    ["html, body", "my-droplet, my-droplet"],
    ["body > main", "my-droplet > main"],
    [".dark\\:bg-black:is(.dark *)", "my-droplet .dark\\:bg-black:is(.dark *)"],
    ["@media-ish .x:hover::after", "my-droplet @media-ish .x:hover::after"],
  ])("%s -> %s", (input, expected) => {
    expect(scopeSelector(input, el)).toBe(expected);
  });

  it("leaves already-scoped selectors alone, so running twice is a no-op", () => {
    expect(scopeSelector("my-droplet .p-4", el)).toBe("my-droplet .p-4");
    expect(scopeSelector(scopeSelector(":root", el), el)).toBe("my-droplet");
  });
});

describe("scopeStylesPlugin", () => {
  type RunInput = { css: string; options: ScopeStylesOptions; from?: string };
  const run = ({ css, options, from }: RunInput) => postcss([scopeStylesPlugin(options)]).process(css, { from }).css;

  it("scopes rules inside layers, media and supports but not keyframes", () => {
    const input = [
      "@layer theme { :root, :host { --color-x: red } }",
      "@layer base { *, ::before { margin: 0 } html { line-height: 1.5 } }",
      "@media (min-width: 40rem) { .sm\\:p-2 { padding: 1rem } }",
      "@supports (display: grid) { .grid { display: grid } }",
      "@keyframes spin { from { rotate: 0deg } to { rotate: 360deg } }",
      "@property --x { syntax: '<length>'; inherits: false; initial-value: 0px }",
      ".p-4 { padding: 1rem }",
    ].join("\n");
    const out = run({ css: input, options: { element: el } });
    expect(out).toContain("my-droplet, my-droplet { --color-x: red }");
    expect(out).toContain("my-droplet *, my-droplet ::before { margin: 0 }");
    expect(out).toContain("my-droplet { line-height: 1.5 }");
    expect(out).toContain("my-droplet .sm\\:p-2 { padding: 1rem }");
    expect(out).toContain("my-droplet .grid { display: grid }");
    expect(out).toContain("from { rotate: 0deg } to { rotate: 360deg }");
    expect(out).toContain("@property --x");
    expect(out).toContain("my-droplet .p-4 { padding: 1rem }");
    expect(out).not.toMatch(/(^|\n)\.p-4/);
  });

  it("only touches files the include filter accepts", () => {
    const css = ".x { color: red }";
    const include = (file: string | undefined) => file?.endsWith("app.css") ?? false;
    expect(run({ css, options: { element: el, include }, from: "/proj/src/app.css" })).toBe("my-droplet .x { color: red }");
    expect(run({ css, options: { element: el, include }, from: "/proj/src/droplets/a/+droplet.svelte" })).toBe(css);
    expect(run({ css, options: { element: el, include } })).toBe(css);
  });

  it("is a PostCSS plugin", () => {
    expect(scopeStylesPlugin.postcss).toBe(true);
    expect(scopeStylesPlugin({ element: el }).postcssPlugin).toBe("droplets:scope-styles");
  });
});

describe("Svelte styles", () => {
  type RunInput = { css: string; from: string };
  const run = ({ css, from }: RunInput) => postcss([scopeStylesPlugin({ element: el })]).process(css, { from }).css;

  it("scope with :global(element) before Svelte compiles them, plainly after", () => {
    const before = run({ css: ":root { color: red } .note { font-style: italic }", from: "/p/Note.svelte.vite-preprocess.css" });
    expect(before).toBe(":global(my-droplet) { color: red } :global(my-droplet) .note { font-style: italic }");
    expect(run({ css: ":global(body) .x { margin: 0 }", from: "/p/A.svelte.vite-preprocess.css" })).toBe(
      ":global(my-droplet) .x { margin: 0 }",
    );
    // Running again, or on what Svelte emits from it, changes nothing.
    expect(run({ css: before, from: "/p/Note.svelte.vite-preprocess.css" })).toBe(before);
    expect(run({ css: "my-droplet .note.svelte-x1 { font-style: italic }", from: "/p/Note.svelte?svelte&type=style&lang.css" })).toBe(
      "my-droplet .note.svelte-x1 { font-style: italic }",
    );
    expect(run({ css: ".note.svelte-x1 { font-style: italic }", from: "/p/Note.svelte?svelte&type=style&lang.css" })).toBe(
      "my-droplet .note.svelte-x1 { font-style: italic }",
    );
  });
});
