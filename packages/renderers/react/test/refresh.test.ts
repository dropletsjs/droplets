// @vitest-environment node
/**
 * React's Fast Refresh compiles React's modules alone. @vitejs/plugin-react
 * turns it on in Vite's shared `oxc` options, which other compilers read:
 * @vitejs/plugin-vue compiles each `<script lang="ts">` with them, and a
 * Vue composable's `useX()` call came out signed as a React hook, with a
 * `$RefreshSig$` the server does not have.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createServer, transformWithOxc, type PluginOption, type ViteDevServer } from "vite";
import { react } from "../src/index.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/refresh");
const COMPOSABLE = `import { ref } from "vue";
export function useCount() { return ref(0); }
const count = useCount();
export default count;`;

let server: ViteDevServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function serve(scope: { include?: RegExp } = {}) {
  const plugins = (react().plugins as (scope: { include?: RegExp }) => PluginOption[])(scope);
  server = await createServer({
    root,
    configFile: false,
    logLevel: "silent",
    plugins,
    server: { middlewareMode: true, ws: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  return server;
}

const code = async (url: string, environment: "client" | "ssr") =>
  (await (server ?? expect.unreachable("the dev server")).environments[environment].transformRequest(url))?.code ?? "";

describe("React Fast Refresh, in vite dev", () => {
  it("is off in the options other compilers share", async () => {
    const { config } = await serve();
    const oxc = config.oxc === false ? undefined : config.oxc;
    expect(typeof oxc?.jsx === "object" && oxc.jsx.refresh).toBe(false);
    // What @vitejs/plugin-vue does with a `<script lang="ts">`.
    const vue = await transformWithOxc(COMPOSABLE, `${root}/Counter.vue`, { ...oxc, lang: "ts" });
    expect(vue.code).not.toContain("$RefreshSig$");
  });

  it("compiles React's components with it, in the browser only", async () => {
    await serve();
    const client = await code("/Hello.tsx", "client");
    expect(client).toContain("$RefreshReg$");
    expect(client).toContain("$RefreshSig$");
    expect(client).toContain("import.meta.hot");
    expect(await code("/Hello.tsx", "ssr")).not.toMatch(/\$Refresh(?:Reg|Sig)\$/);
  });

  it("compiles only the modules core marks as React's when another renderer shares .tsx", async () => {
    await serve({ include: /[?&]droplets-renderer=react(?:&|$)/ });
    expect(await code("/Hello.tsx?droplets-renderer=react", "client")).toContain("$RefreshReg$");
    expect(await code("/Hello.tsx?droplets-renderer=solid", "client")).not.toMatch(/\$Refresh(?:Reg|Sig)\$/);
  });
});
