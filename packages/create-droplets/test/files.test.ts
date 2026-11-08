import { describe, expect, it } from "vitest";
import { agentsMd } from "../src/agents.ts";
import type { Adapter, Choices } from "../src/choices.ts";
import { dropletsConfig, packageJson, projectFiles, scripts, tsconfig, viteConfig } from "../src/files.ts";
import { FRAMEWORKS, frameworkNamed } from "../src/shared.ts";

const choices = (overrides: Partial<Omit<Choices, "frameworks">> & { frameworks?: string[] } = {}): Choices => {
  const { frameworks = ["svelte"], ...rest } = overrides;
  return {
    folder: "acme-widgets",
    name: "acme-widgets",
    element: "acme-widgets",
    adapters: ["node"] as Adapter[],
    tailwind: false,
    injectTool: false,
    claude: false,
    pm: "npm",
    ...rest,
    frameworks: frameworks.map((name) => frameworkNamed(name)!),
  };
};

describe("the project files", () => {
  it("writes a starter droplet per framework, with a server load", () => {
    const files = Object.keys(projectFiles(choices({ frameworks: FRAMEWORKS.map((f) => f.name) })));
    for (const droplet of ["hello-svelte", "hello-vue", "hello-react", "hello-preact", "hello-solid", "hello-hono", "hello-handlebars", "hello-lit"]) {
      expect(files.filter((file) => file.startsWith(`src/droplets/${droplet}/`)).length, droplet).toBe(2);
      expect(files).toContain(`src/droplets/${droplet}/+droplet.server.ts`);
    }
    expect(files).toContain("svelte.config.js");
  });

  it("writes CLAUDE.md only for Claude, wrangler.jsonc only for Cloudflare", () => {
    const plain = projectFiles(choices({ frameworks: ["react"] }));
    expect(Object.keys(plain).toSorted()).toEqual([
      ".gitignore",
      "AGENTS.md",
      "README.md",
      "droplets.config.ts",
      "package.json",
      "src/app.css",
      "src/droplets/hello-react/+droplet.server.ts",
      "src/droplets/hello-react/+droplet.tsx",
      "tsconfig.json",
      "vite.config.ts",
    ]);
    const all = projectFiles(choices({ claude: true, adapters: ["node", "cloudflare"] }));
    expect(all["CLAUDE.md"]).toBe("@AGENTS.md\n");
    expect(JSON.parse(all["wrangler.jsonc"]!)).toMatchObject({ name: "acme-widgets", main: "dist/worker.js" });
  });

  it("asks for the packages each choice needs, at versions baked in", () => {
    const pkg = JSON.parse(packageJson(choices({ frameworks: ["react"], adapters: ["node", "cloudflare"], tailwind: true }))) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies)).toEqual(["@dropletsjs/droplets", "react", "react-dom"]);
    expect(Object.keys(pkg.devDependencies)).toEqual([
      "@dropletsjs/adapter-cloudflare",
      "@dropletsjs/adapter-node",
      "@dropletsjs/devtools",
      "@dropletsjs/renderer-react",
      "@tailwindcss/vite",
      "@types/node",
      "@types/react",
      "@types/react-dom",
      "tailwindcss",
      "typescript",
      "vite",
      "wrangler",
    ]);
    for (const range of [...Object.values(pkg.dependencies), ...Object.values(pkg.devDependencies)]) expect(range).toMatch(/^\^\d/);
    const preact = JSON.parse(packageJson(choices({ frameworks: ["preact"] }))) as typeof pkg;
    expect(preact.dependencies).toMatchObject({ preact: "^11.0.0", "preact-render-to-string": "^6.8.0" });
    expect(preact.devDependencies["@dropletsjs/renderer-preact"]).toMatch(/^\^\d/);
    const lean = JSON.parse(packageJson(choices())) as { devDependencies: Record<string, string> };
    expect(lean.devDependencies).not.toHaveProperty("tailwindcss");
    expect(lean.devDependencies).not.toHaveProperty("wrangler");
  });

  it("has a build and a start for each adapter, sync on prepare", () => {
    expect(scripts(choices())).toEqual({
      dev: "vite",
      build: "vite build",
      preview: "vite preview",
      start: "node dist/server.js",
      sync: "djs sync",
      typecheck: "djs sync && tsc -p tsconfig.json",
      prepare: "djs sync",
    });
    const several = scripts(choices({ adapters: ["cloudflare", "bun", "deno"] }));
    expect(several).toMatchObject({
      build: "vite build",
      start: "wrangler dev",
      deploy: "wrangler deploy",
      "build:bun": "DROPLETS_ADAPTER=bun vite build",
      "start:bun": "bun dist/server.js",
      "build:deno": "DROPLETS_ADAPTER=deno vite build",
      "start:deno": "deno serve -A dist/server.js",
    });
    expect(several).not.toHaveProperty("build:cloudflare");
  });

  it("calls one adapter directly, and picks among several with DROPLETS_ADAPTER", () => {
    const one = viteConfig(choices({ frameworks: ["svelte", "hono-jsx"], tailwind: true }));
    expect(one).toContain('import { node } from "@dropletsjs/adapter-node";');
    expect(one).toContain("      adapter: node(),");
    expect(one).toContain("renderers: [svelte(), honoJsx()]");
    expect(one).toContain("css: { tailwind: true }");
    expect(one).toContain("dropletsDevtools()");
    expect(one).not.toContain("DROPLETS_ADAPTER");

    const several = viteConfig(choices({ adapters: ["node", "cloudflare", "bun", "deno"] }));
    expect(several).toContain("const adapters = { node, cloudflare, bun, deno };");
    expect(several).toContain('(adapters[process.env["DROPLETS_ADAPTER"] as keyof typeof adapters] ?? node)()');
    expect(several).toContain("      adapter,");
    expect(several).not.toContain("tailwind");
    expect(viteConfig(choices({ adapters: ["cloudflare", "deno"] }))).toContain("?? cloudflare)()");
  });

  it("names the element, and injects the dev tool only when asked", () => {
    expect(dropletsConfig(choices())).toContain('element: "acme-widgets"');
    expect(dropletsConfig(choices())).not.toContain("injectTool");
    expect(dropletsConfig(choices({ injectTool: true }))).toContain("dev: { injectTool: true }");
  });

  it("extends .droplets/ and turns JSX on for the first JSX framework", () => {
    const parse = (text: string) => JSON.parse(text.replace(/^\s*\/\/.*$/gm, "")) as { extends: string; compilerOptions: Record<string, unknown>; include: string[] };
    const svelte = parse(tsconfig(choices()));
    expect(svelte.extends).toBe("./.droplets/tsconfig.json");
    expect(svelte.compilerOptions).not.toHaveProperty("jsx");
    expect(svelte.include).not.toContain("src/**/*.tsx");
    const jsx = parse(tsconfig(choices({ frameworks: ["svelte", "react", "solid"] })));
    expect(jsx.compilerOptions).toMatchObject({ jsx: "react-jsx", jsxImportSource: "react" });
    expect(jsx.include).toContain("src/**/*.tsx");
  });
});

describe("AGENTS.md", () => {
  it("opens with the one-framework rule", () => {
    const text = agentsMd(choices({ frameworks: ["svelte", "react"] }));
    const first = text.indexOf("## ");
    expect(text.slice(first)).toMatch(/^## The first rule: one framework per droplet\n\n\*\*Always import only the droplet's own framework in its code\.\*\*/);
    expect(text).toContain("src/lib/api.ts");
    expect(text).toContain("src/lib/react/Card.tsx");
  });

  it("is written for the project's frameworks, adapters and package manager", () => {
    const text = agentsMd(choices({ frameworks: ["react", "solid", "handlebars"], adapters: ["node", "deno"], pm: "pnpm" }));
    expect(text).toContain("Frameworks: React, Solid, Handlebars. Adapters: node, deno (`vite build` targets node).");
    expect(text).toContain("| `pnpm run build:deno` |");
    expect(text).toContain("pnpm exec djs add <name> --framework react");
    expect(text).toContain("`/** @jsxImportSource solid-js */`");
    expect(text).toContain("- Handlebars: the comment the template opens with");
    expect(text).not.toContain("- Svelte:");
    expect(text).toContain("/droplets/hello-react?who=Ana");
    // One JSX framework: no pragma note.
    expect(agentsMd(choices({ frameworks: ["react"] }))).not.toContain("@jsxImportSource");
  });
});
