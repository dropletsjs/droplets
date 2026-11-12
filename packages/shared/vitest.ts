import type { ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createBuilder, type PluginOption } from "vite";
import type { ViteUserConfig } from "vitest/config";

/** happy-dom, where a `<link rel="stylesheet">` the element appends must not throw. */
export const happyDom = {
  environment: "happy-dom",
  environmentOptions: { happyDOM: { settings: { handleDisabledFileLoadingAsSuccess: true } } },
} satisfies NonNullable<ViteUserConfig["test"]>;

/** A renderer's suite. The conformance kit mounts the built bundles in happy-dom. */
export const rendererTests: ViteUserConfig = {
  test: { include: ["test/**/*.test.ts"], ...happyDom, testTimeout: 60_000 },
};

/** An adapter's suite: it builds the fixture app and serves it. */
export const adapterTests: ViteUserConfig = {
  test: { include: ["test/**/*.test.ts"], environment: "node", testTimeout: 60_000 },
};

/** The framework's own fixture app (the fake renderer of `@dropletsjs/droplets/testing`, element `test-droplet`), which every adapter's tests build. */
export const FIXTURE_ROOT = fileURLToPath(new URL("../droplets/test/fixtures/app/", import.meta.url));

export type BuildFixtureAppInput = { outDir: string; plugins: PluginOption[] };

/** Builds the fixture app with `plugins` (an adapter's `droplets()`) into `outDir`, emptied first; `@dropletsjs/droplets` must be built. */
export async function buildFixtureApp({ outDir, plugins }: BuildFixtureAppInput): Promise<void> {
  if (!existsSync(resolve(FIXTURE_ROOT, "../../../dist/vite.js"))) {
    throw new Error("Build @dropletsjs/droplets first (pnpm build at the root).");
  }
  await rm(outDir, { recursive: true, force: true });
  const builder = await createBuilder({ root: FIXTURE_ROOT, configFile: false, logLevel: "silent", build: { outDir }, plugins });
  await builder.buildApp();
}

export type WaitForServerInput = { url: string; child: ChildProcess; name: string };

/** Polls `url` every 100 ms, up to ten seconds, until it answers ok; fails as soon as `child` (the `name` server) exits. */
export async function waitForServer({ url, child, name }: WaitForServerInput): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`${name} exited with ${child.exitCode}`);
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Not listening yet: try again.
    }
    await new Promise((wake) => setTimeout(wake, 100));
  }
  throw new Error(`${url} never answered`);
}

export type StopServerInput = { child: ChildProcess | undefined; timeout?: number };

/** Sends `child` SIGTERM and resolves once it has exited, sending SIGKILL after `timeout` ms (default 5 s); a child that never started or already exited resolves at once. */
export async function stopServer({ child, timeout = 5_000 }: StopServerInput): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((done) => child.once("exit", () => done()));
  child.kill();
  const timer = setTimeout(() => child.kill("SIGKILL"), timeout);
  await exited;
  clearTimeout(timer);
}
