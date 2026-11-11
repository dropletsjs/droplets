import { describe, expect, it } from "vitest";
import { dropletsConfig, packageJson, packageManagerFiles, projectFiles, scripts, tsconfig, viteConfig } from "../src/files.ts";
import { FRAMEWORKS } from "../src/shared.ts";
import { choicesWith } from "./choices-with.ts";

describe("the project files", () => {
  it("writes a starter droplet per framework, with a server load", () => {
    const files = Object.keys(projectFiles(choicesWith({ frameworks: FRAMEWORKS.map((f) => f.name) })));
    for (const droplet of [
      "hello-svelte",
      "hello-vue",
      "hello-react",
      "hello-preact",
      "hello-solid",
      "hello-hono",
      "hello-handlebars",
      "hello-lit",
    ]) {
      expect(files.filter((file) => file.startsWith(`src/droplets/${droplet}/`)).length, droplet).toBe(2);
      expect(files).toContain(`src/droplets/${droplet}/+droplet.server.ts`);
    }
    expect(files).toContain("svelte.config.js");
  });

  it("writes CLAUDE.md only for Claude, wrangler.jsonc only for Cloudflare", () => {
    const plain = projectFiles(choicesWith({ frameworks: ["react"] }));
    expect(Object.keys(plain).toSorted()).toEqual([
      ".gitignore",
      ".npmrc",
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
    const all = projectFiles(choicesWith({ claude: true, adapters: ["node", "cloudflare"] }));
    expect(all["CLAUDE.md"]).toBe("@AGENTS.md\n");
    expect(JSON.parse(all["wrangler.jsonc"] ?? expect.unreachable("wrangler.jsonc"))).toMatchObject({
      name: "acme-widgets",
      main: "dist/worker.js",
    });
  });

  it("has the package manager install only versions 7 days old, Droplets' own exempt", () => {
    expect(packageManagerFiles({ pm: "npm" })[".npmrc"]).toMatch(/^min-release-age=7\nmin-release-age-exclude=@dropletsjs\/\*\n$/m);
    expect(packageManagerFiles({ pm: "pnpm" })["pnpm-workspace.yaml"]).toMatch(
      /^minimumReleaseAge: 10080\nminimumReleaseAgeExclude:\n {2}- "@dropletsjs\/\*"\n$/m,
    );
    expect(packageManagerFiles({ pm: "yarn" })[".yarnrc.yml"]).toMatch(
      /^npmMinimalAgeGate: 10080\nnpmPreapprovedPackages:\n {2}- "@dropletsjs\/\*"\n$/m,
    );
    const bun = packageManagerFiles({ pm: "bun" })["bunfig.toml"] ?? expect.unreachable("bunfig.toml");
    expect(bun).toMatch(/^\[install\]\n/);
    expect(bun).toContain("\nminimumReleaseAge = 604800\n");
    expect(bun).toMatch(/^minimumReleaseAgeExcludes = \[.*"@dropletsjs\/droplets".*"@dropletsjs\/renderer-lit".*\]$/m);
    const deno = JSON.parse(packageManagerFiles({ pm: "deno" })["deno.json"] ?? expect.unreachable("deno.json")) as {
      minimumDependencyAge: { age: string; exclude: string[] };
    };
    expect(deno.minimumDependencyAge.age).toBe("P7D");
    expect(deno.minimumDependencyAge.exclude).toHaveLength(14);
    expect(deno.minimumDependencyAge.exclude).toContain("npm:@dropletsjs/adapter-deno");
    expect(Object.keys(projectFiles(choicesWith({ pm: "bun" })))).toContain("bunfig.toml");
    expect(Object.keys(projectFiles(choicesWith({ pm: "bun" })))).not.toContain(".npmrc");
  });

  it("asks for the packages each choice needs, at versions baked in", () => {
    const pkg = JSON.parse(packageJson(choicesWith({ frameworks: ["react"], adapters: ["node", "cloudflare"], tailwind: true }))) as {
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
    const preact = JSON.parse(packageJson(choicesWith({ frameworks: ["preact"] }))) as typeof pkg;
    expect(preact.dependencies).toMatchObject({ preact: "^11.0.0", "preact-render-to-string": "^6.8.0" });
    expect(preact.devDependencies["@dropletsjs/renderer-preact"]).toMatch(/^\^\d/);
    const lean = JSON.parse(packageJson(choicesWith())) as { devDependencies: Record<string, string> };
    expect(lean.devDependencies).not.toHaveProperty("tailwindcss");
    expect(lean.devDependencies).not.toHaveProperty("wrangler");
  });

  it("has a build and a start for each adapter, sync on prepare", () => {
    expect(scripts(choicesWith())).toEqual({
      dev: "vite",
      build: "vite build",
      preview: "vite preview",
      start: "node dist/server.js",
      sync: "djs sync",
      typecheck: "djs sync && tsc -p tsconfig.json",
      prepare: "djs sync",
    });
    const several = scripts(choicesWith({ adapters: ["cloudflare", "bun", "deno"] }));
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
    const one = viteConfig(choicesWith({ frameworks: ["svelte", "hono-jsx"], tailwind: true }));
    expect(one).toContain('import { node } from "@dropletsjs/adapter-node";');
    expect(one).toContain("      adapter: node(),");
    expect(one).toContain("renderers: [svelte(), honoJsx()]");
    expect(one).toContain("css: { tailwind: true }");
    expect(one).toContain("dropletsDevtools()");
    expect(one).not.toContain("DROPLETS_ADAPTER");

    const several = viteConfig(choicesWith({ adapters: ["node", "cloudflare", "bun", "deno"] }));
    expect(several).toContain("const adapters = { node, cloudflare, bun, deno };");
    expect(several).toContain('(adapters[process.env["DROPLETS_ADAPTER"] as keyof typeof adapters] ?? node)()');
    expect(several).toContain("      adapter,");
    expect(several).not.toContain("tailwind");
    expect(viteConfig(choicesWith({ adapters: ["cloudflare", "deno"] }))).toContain("?? cloudflare)()");
  });

  it("names the element, and injects the dev tool only when asked", () => {
    expect(dropletsConfig(choicesWith())).toContain('element: "acme-widgets"');
    expect(dropletsConfig(choicesWith())).not.toContain("injectTool");
    expect(dropletsConfig(choicesWith({ injectTool: true }))).toContain("dev: { injectTool: true }");
  });

  it("extends .droplets/ and turns JSX on for the first JSX framework", () => {
    const parse = (text: string) =>
      JSON.parse(text.replace(/^\s*\/\/.*$/gm, "")) as { extends: string; compilerOptions: Record<string, unknown>; include: string[] };
    const svelte = parse(tsconfig(choicesWith()));
    expect(svelte.extends).toBe("./.droplets/tsconfig.json");
    expect(svelte.compilerOptions).not.toHaveProperty("jsx");
    expect(svelte.include).not.toContain("src/**/*.tsx");
    const jsx = parse(tsconfig(choicesWith({ frameworks: ["svelte", "react", "solid"] })));
    expect(jsx.compilerOptions).toMatchObject({ jsx: "react-jsx", jsxImportSource: "react" });
    expect(jsx.include).toContain("src/**/*.tsx");
  });
});
