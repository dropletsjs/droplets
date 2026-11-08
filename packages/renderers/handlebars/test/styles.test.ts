import { describe, expect, it } from "vitest";
import { extractStyles, parseStyleId, styleId } from "../src/styles.ts";

describe("extractStyles()", () => {
  it("takes inline and src blocks out, in order, keeping the lines", () => {
    const source = `<p class="a">{{data.x}}</p>\n<style>\n  .a { color: red; }\n</style>\n<style src="./b.css"></style>\n<style lang="scss">.c { d: e }</style>\n<i>{{y}}</i>\n`;
    const { template, styles } = extractStyles(source, "x/+droplet.hbs");
    expect(styles).toEqual([
      { kind: "inline", css: "\n  .a { color: red; }\n", lang: "css" },
      { kind: "src", src: "./b.css" },
      { kind: "inline", css: ".c { d: e }", lang: "scss" },
    ]);
    expect(template).not.toContain("style");
    expect(template.split("\n")).toHaveLength(source.split("\n").length);
    expect(template).toContain('<p class="a">{{data.x}}</p>');
    expect(template).toContain("<i>{{y}}</i>");
  });

  it("leaves a template without blocks, and a commented-out one, as it is", () => {
    expect(extractStyles("<p>{{x}}</p>", "x")).toEqual({ template: "<p>{{x}}</p>", styles: [] });
    const commented = "{{!-- <style>.a{}</style> --}}<p/>";
    expect(extractStyles(commented, "x")).toEqual({ template: commented, styles: [] });
  });

  it("refuses a block that is not static", () => {
    expect(() => extractStyles("{{#if x}}<style>.a{}</style>{{/if}}", "t.hbs")).toThrow(/t\.hbs:1: a <style> block goes at the top/);
    expect(() => extractStyles("<style>.a { color: {{c}} }</style>", "t.hbs")).toThrow(/cannot contain \{\{…\}\}/);
    expect(() => extractStyles('<style src="./a.css">.b{}</style>', "t.hbs")).toThrow(/leave the block empty/);
  });
});

describe("style ids", () => {
  it("are .css ids of the template, and read back", () => {
    const id = styleId("/app/src/droplets/a/+droplet.hbs", 2, "css");
    expect(id).toBe("/app/src/droplets/a/+droplet.hbs?droplets-style=2&lang.css");
    expect(parseStyleId(id)).toEqual({ file: "/app/src/droplets/a/+droplet.hbs", index: 2 });
    expect(parseStyleId("/app/a.hbs")).toBeUndefined();
  });
});
