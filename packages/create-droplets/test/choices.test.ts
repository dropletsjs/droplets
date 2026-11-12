import { describe, expect, it } from "vitest";
import {
  commands,
  defaultAdapter,
  elementProblem,
  packageNameFor,
  parseFlags,
  starterName,
  suggestElement,
  USAGE,
} from "../src/choices.ts";
import { frameworkNamed } from "../src/shared.ts";

describe("parseFlags", () => {
  it("leaves what is not given undefined, and installs and commits by default", () => {
    expect(parseFlags({ argv: [] })).toEqual({ install: true, git: true, yes: false, help: false });
  });

  it("reads every flag", () => {
    const flags = parseFlags({
      argv: [
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
      ],
    });
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
    expect(parseFlags({ argv: ["--frameworks", "hono,hono-jsx, react"] }).frameworks?.map((f) => f.name)).toEqual(["react", "hono-jsx"]);
  });

  it("names what it does not know", () => {
    expect(() => parseFlags({ argv: ["--frameworks", "angular"] })).toThrow(
      "--frameworks angular: expected svelte, vue, react, preact, solid, hono-jsx, handlebars, lit",
    );
    expect(() => parseFlags({ argv: ["--adapters", "vercel"] })).toThrow("--adapters vercel: expected node, cloudflare, bun, deno");
    expect(() => parseFlags({ argv: ["--frameworks", ","] })).toThrow("--frameworks: name at least one");
    expect(() => parseFlags({ argv: ["--pm", "pip"] })).toThrow("--pm pip");
    expect(() => parseFlags({ argv: ["--element", "widgets"] })).toThrow("--element widgets");
    expect(() => parseFlags({ argv: ["a", "b"] })).toThrow("one folder");
    expect(() => parseFlags({ argv: ["--colour"] })).toThrow();
  });
});

describe("names", () => {
  it("makes a package name of the folder", () => {
    expect(packageNameFor({ folder: "My Widgets" })).toBe("my-widgets");
    expect(packageNameFor({ folder: "../apps/shop.droplets/" })).toBe("shop.droplets");
    expect(packageNameFor({ folder: "__" })).toBe("droplets");
  });

  it("suggests the folder as the element, with -droplets when it has no hyphen", () => {
    expect(suggestElement({ folder: "acme-widgets" })).toBe("acme-widgets");
    expect(suggestElement({ folder: "shop" })).toBe("shop-droplets");
    expect(suggestElement({ folder: "2fast" })).toBe("fast-droplets");
    expect(suggestElement({ folder: "123" })).toBe("my-droplets");
    for (const folder of ["shop", "acme-widgets", "Big Shop", "x.y"]) {
      expect(elementProblem({ element: suggestElement({ folder }) })).toBeUndefined();
    }
    // The usage says what the code does.
    expect(USAGE).toContain(
      "--element <name>        the custom element (default: the folder name, or <folder>-droplets when it has no hyphen)",
    );
  });

  it("names the starter droplets", () => {
    expect(starterName({ framework: frameworkNamed({ name: "svelte" }) ?? expect.unreachable("svelte") })).toBe("hello-svelte");
    expect(starterName({ framework: frameworkNamed({ name: "hono-jsx" }) ?? expect.unreachable("hono-jsx") })).toBe("hello-hono");
  });
});

describe("adapters and package managers", () => {
  it("builds for node when it is chosen, else the first", () => {
    expect(defaultAdapter({ adapters: ["cloudflare", "node"] })).toBe("node");
    expect(defaultAdapter({ adapters: ["cloudflare", "deno"] })).toBe("cloudflare");
  });

  it("spells each package manager's commands", () => {
    expect(commands({ pm: "npm" })).toEqual({ install: "npm install", run: "npm run", djs: "npx djs" });
    expect(commands({ pm: "pnpm" }).djs).toBe("pnpm exec djs");
    expect(commands({ pm: "bun" }).run).toBe("bun run");
    expect(commands({ pm: "deno" })).toEqual({
      install: "deno install",
      run: "deno task",
      djs: "deno run -A npm:@dropletsjs/droplets/djs",
    });
  });
});
