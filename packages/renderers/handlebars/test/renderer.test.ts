// @vitest-environment node
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateRenderers, type ReadFlagsInput } from "@dropletsjs/droplets";
import { handlebars, readFlags, readTemplateFlags } from "../src/index.ts";

/** What core hands `readFlags`. */
function input(kind: ReadFlagsInput["kind"], source = "<p/>"): ReadFlagsInput {
  return {
    kind,
    source,
    file: kind === "droplet" ? "+droplet.hbs" : "+error.hbs",
    folder: "/app/src/droplets/hello",
    droplet: "hello",
  };
}

describe("handlebars()", () => {
  it("claims .hbs and points at its built server and client modules", () => {
    const renderer = handlebars();
    expect(renderer.name).toBe("handlebars");
    expect(renderer.extensions).toEqual([".hbs"]);
    expect(validateRenderers([renderer]).get(".hbs")).toEqual([renderer]);
    expect(renderer.packages).toEqual(["handlebars", "@dropletsjs/renderer-handlebars"]);
    expect(renderer.server).toMatch(/[\\/]dist[\\/]server\.js$/);
    expect(renderer.client).toMatch(/[\\/]dist[\\/]client\.js$/);
    expect(existsSync(renderer.server), "build the package first").toBe(true);
    expect(existsSync(renderer.client)).toBe(true);
    expect(renderer.plugins).toHaveLength(1);
    expect(renderer.readFlags).toBe(readFlags);
  });
});

describe("readFlags", () => {
  it("reads the flags from the template's opening comment, for either kind", () => {
    expect(readFlags(input("droplet", "{{!--\nexport hydrate = false\nexport prerender = true\n--}}\n<p/>"))).toEqual({
      hydrate: false,
      prerender: true,
    });
    expect(readFlags(input("error", "{{!-- export prerender = true --}}<p/>"))).toEqual({ prerender: true });
  });

  it("declares nothing without the comment, so core applies the defaults", () => {
    expect(readFlags(input("droplet"))).toBeUndefined();
  });
});

describe("readTemplateFlags", () => {
  const read = (source: string) => readTemplateFlags(source, "hello/+droplet.hbs");

  it("reads a multi-line block comment the template opens with", () => {
    expect(read("{{!--\nexport hydrate = false\nexport prerender = true\nexport ssr = true\n--}}\n<p/>")).toEqual({
      hydrate: false,
      prerender: true,
      ssr: true,
    });
  });

  it("reads a one-line or short comment, `const` and a trailing semicolon too", () => {
    expect(read("{{!-- export ssr = false --}}<p/>")).toEqual({ ssr: false });
    expect(read("{{! export const hydrate = false; }}<p/>")).toEqual({ hydrate: false });
    expect(read("\n  {{~!-- export prerender = true --~}}\n<p/>")).toEqual({ prerender: true });
  });

  it("reads several flags on one line, split by `;` or by the next `export`", () => {
    expect(read("{{!-- export hydrate = false; export prerender = true --}}<p/>")).toEqual({ hydrate: false, prerender: true });
    expect(read("{{!-- export const ssr = false export hydrate = false; --}}<p/>")).toEqual({ ssr: false, hydrate: false });
    expect(() => read("{{!-- export ssr = false and more --}}")).toThrow('flag "ssr" must be true or false, found "false and more"');
  });

  it("reads when the template hydrates", () => {
    expect(read('{{!-- export hydrate = "visible" --}}<p/>')).toEqual({ hydrate: "visible" });
    expect(read("{{!-- export hydrate = 'interactive' --}}<p/>")).toEqual({ hydrate: "interactive" });
    expect(() => read('{{!-- export hydrate = "idle" --}}')).toThrow(
      'flag "hydrate" must be true, false, "visible" or "interactive", found ""idle""',
    );
    expect(() => read('{{!-- export ssr = "visible" --}}')).toThrow('flag "ssr" must be true or false');
  });

  it("leaves a template without the comment, or with an ordinary one, to the defaults", () => {
    expect(read("<p/>")).toBeUndefined();
    expect(read("{{!-- The card of the signed-in user --}}<p/>")).toBeUndefined();
    expect(read("")).toBeUndefined();
  });

  it("refuses flags anywhere but the first thing in the template", () => {
    const message = "flags go in the comment the template starts with, before anything else";
    expect(() => read("<p/>\n{{!-- export ssr = false --}}")).toThrow(message);
    expect(() => read("{{!-- A card --}}\n{{!-- export ssr = false --}}<p/>")).toThrow(message);
    expect(() => read("{{#if x}}{{! export hydrate = false }}{{/if}}")).toThrow(message);
  });

  it("refuses anything but flag lines in a flags comment", () => {
    expect(() => read("{{!--\nexport ssr = false\nShows the card\n--}}")).toThrow(
      'expected `export <flag> = true|false` in the flags comment, found "Shows the card"',
    );
    expect(() => read("{{!-- export hydrat = false --}}")).toThrow('unknown flag "hydrat"');
    expect(() => read("{{!-- export ssr = no --}}")).toThrow('flag "ssr" must be true or false, found "no"');
    expect(() => read("{{!--\nexport ssr = false\nexport ssr = true\n--}}")).toThrow('flag "ssr" is declared twice');
  });

  it("names the file in its errors and leaves a broken template to the compiler", () => {
    expect(() => read("{{!-- export nope = true --}}")).toThrow(/^droplets: hello\/\+droplet\.hbs: /);
    expect(read("{{!-- export ssr = false --}}{{#if}}")).toBeUndefined();
  });
});
