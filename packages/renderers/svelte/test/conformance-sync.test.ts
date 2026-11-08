import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { rendererConformance } from "@dropletsjs/droplets/testing";
import { svelte } from "../src/index.ts";

// The same kit without async mode: `mount` waits for `data`, so `hello`
// reads `data.greeting` as it would when hydrating. A copy of the fixture,
// next to it so `svelte` resolves, with that one line changed.
const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures");
const root = resolve(fixtures, ".app-sync");
rmSync(root, { recursive: true, force: true });
cpSync(resolve(fixtures, "app"), root, {
  recursive: true,
  filter: (source) => !/[\\/](dist[^\\/]*|node_modules)$/.test(source),
});
const hello = resolve(root, "src/droplets/hello/+droplet.svelte");
const source = readFileSync(hello, "utf8");
const synced = source.replace("{(await data).greeting}", "{data.greeting}");
if (synced === source) throw new Error("the hello fixture no longer reads `(await data).greeting`");
writeFileSync(hello, synced);

rendererConformance({ renderer: svelte(), root });
