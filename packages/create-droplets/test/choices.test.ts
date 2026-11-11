import { describe, expect, it } from "vitest";
import { commands, defaultAdapter, elementProblem, packageNameFor, parseFlags, starterName, suggestElement } from "../src/choices.ts";
import { frameworkNamed } from "../src/shared.ts";

describe("parseFlags", () => {
  it("leaves what is not given undefined, and installs and commits by default", () => {
    expect(parseFlags([])).toEqual({ install: true, git: true, yes: false, help: false });
  });

  it("reads every flag", () => {
    const flags = parseFlags([
      "widgets",
      "--element",
      "acme-widgets",
      "--frameworks",
      "vue,svelte",
      "--adapters",
      "deno,cloudflare",
      "--no-tailwind",
      "--inject-tool",
      "--claude",
      "--pm",
      "pnpm",
      "--no-install",
      "--no-git",
      "-y",
    ]);
    expect(flags).toMatchObject({
      folder: "widgets",
      element: "acme-widgets",
      adapters: ["cloudflare", "deno"],
      tailwind: false,
      injectTool: true,
      claude: true,
      pm: "pnpm",
      install: false,
      git: false,
      yes: true,
    });
    // Catalog order, whatever order the flag gave.
    expect(flags.frameworks?.map((f) => f.name)).toEqual(["svelte", "vue"]);
  });

  it("takes hono for hono-jsx and drops repeats", () => {
    expect(parseFlags(["--frameworks", "hono,hono-jsx, react"]).frameworks?.map((f) => f.name)).toEqual(["react", "hono-jsx"]);
  });

  it("names what it does not know", () => {
    expect(() => parseFlags(["--frameworks", "angular"])).toThrow(
      "--frameworks angular: expected svelte, vue, react, preact, solid, hono-jsx, handlebars, lit",
    );
    expect(() => parseFlags(["--adapters", "vercel"])).toThrow("--adapters vercel: expected node, cloudflare, bun, deno");
    expect(() => parseFlags(["--frameworks", ","])).toThrow("--frameworks: name at least one");
    expect(() => parseFlags(["--pm", "pip"])).toThrow("--pm pip");
    expect(() => parseFlags(["--element", "widgets"])).toThrow("--element widgets");
    expect(() => parseFlags(["a", "b"])).toThrow("one folder");
    expect(() => parseFlags(["--colour"])).toThrow();
  });
});

describe("names", () => {
  it("makes a package name of the folder", () => {
    expect(packageNameFor("My Widgets")).toBe("my-widgets");
    expect(packageNameFor("../apps/shop.droplets/")).toBe("shop.droplets");
    expect(packageNameFor("__")).toBe("droplets");
  });

  it("suggests the folder as the element, with -droplets when it has no hyphen", () => {
    expect(suggestElement("acme-widgets")).toBe("acme-widgets");
    expect(suggestElement("shop")).toBe("shop-droplets");
    expect(suggestElement("2fast")).toBe("fast-droplets");
    expect(suggestElement("123")).toBe("my-droplets");
    for (const folder of ["shop", "acme-widgets", "Big Shop", "x.y"]) expect(elementProblem(suggestElement(folder))).toBeUndefined();
  });

  it("names the starter droplets", () => {
    expect(starterName(frameworkNamed("svelte") ?? expect.unreachable("svelte"))).toBe("hello-svelte");
    expect(starterName(frameworkNamed("hono-jsx") ?? expect.unreachable("hono-jsx"))).toBe("hello-hono");
  });
});

describe("adapters and package managers", () => {
  it("builds for node when it is chosen, else the first", () => {
    expect(defaultAdapter(["cloudflare", "node"])).toBe("node");
    expect(defaultAdapter(["cloudflare", "deno"])).toBe("cloudflare");
  });

  it("spells each package manager's commands", () => {
    expect(commands("npm")).toEqual({ install: "npm install", run: "npm run", djs: "npx djs" });
    expect(commands("pnpm").djs).toBe("pnpm exec djs");
    expect(commands("bun").run).toBe("bun run");
    expect(commands("deno")).toEqual({ install: "deno install", run: "deno task", djs: "deno run -A npm:@dropletsjs/droplets/djs" });
  });
});
