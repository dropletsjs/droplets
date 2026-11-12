import type { ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { createServer, type AddressInfo } from "node:net";
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

/** An adapter's suite: it builds the fixture app in a `beforeAll` and serves it, so hooks get the tests' 60 s too. */
export const adapterTests: ViteUserConfig = {
  test: { include: ["test/**/*.test.ts"], environment: "node", testTimeout: 60_000, hookTimeout: 60_000 },
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

/** A port the OS has free now, for a server that must be told its port before it starts. */
export function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const probe = createServer();
    probe.once("error", fail);
    // Every interface, so the port is free on IPv4 and IPv6 alike.
    probe.listen(0, () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => done(port));
    });
  });
}

export type OnFreePortInput<T> = {
  /** Starts the server on `port`, or throws why it could not (a child's exit with its output, Vite's own error). */
  start: (port: number) => Promise<T>;
};

/**
 * `start` on a port from `freePort()`, and again on a new one when that
 * port turns out taken: the probe frees it before the server binds it, and
 * another process may take it in between.
 */
export async function onFreePort<T>({ start }: OnFreePortInput<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await start(await freePort());
    } catch (error) {
      if (attempt === 5 || !isPortTaken(error)) throw error;
    }
  }
}

/** Node's, Vite's, Bun's, Deno's and workerd's words for a port someone else holds. */
function isPortTaken(error: unknown): boolean {
  const text = error instanceof Error ? `${(error as NodeJS.ErrnoException).code ?? ""} ${error.message}` : String(error);
  return /EADDRINUSE|AddrInUse|already in use|is port \d+ in use/i.test(text);
}

export type ListensOnInput = { output: string; port: number };

/**
 * Whether a server's own output names `port` (Vite's `Local:` line, Bun's
 * `Started server:`, `deno serve`'s `Listening on`): its word that it holds
 * the port, where any process on the port could answer a fetch.
 */
export function listensOn({ output, port }: ListensOnInput): boolean {
  // Without the colours a CI may force on.
  return new RegExp(`:${port}(?![0-9])`).test(output.replace(/\u001b\[[0-9;]*m/g, ""));
}

export type FromBuildInput = { outDir: string };

/**
 * An `isOurs` for a built server, which says nothing when it starts: the
 * answer names the build in `outDir` (`client/droplets.json`'s `__hash`), as
 * every fragment does in `x-droplets-build`.
 */
export async function fromBuild({ outDir }: FromBuildInput): Promise<(response: Response) => boolean> {
  const { __hash: hash } = JSON.parse(await readFile(resolve(outDir, "client/droplets.json"), "utf8")) as { __hash: string };
  return (response) => response.headers.get("x-droplets-build") === hash;
}

export type WaitForServerInput = {
  url: string;
  child: ChildProcess;
  name: string;
  /** The child's output so far, for the error when it exits. */
  output?: () => string;
  /** Whether the answer is the child's own (`listensOn` its output, `fromBuild`), not another server's on the port. */
  isOurs?: (response: Response) => boolean;
};

/** Polls `url` every 100 ms, up to ten seconds, until it answers ok and `isOurs`; fails as soon as `child` (the `name` server) exits, with its `output`. */
export async function waitForServer({ url, child, name, isOurs, output }: WaitForServerInput): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`${name} exited with ${child.exitCode}${output ? `:\n${output()}` : ""}`);
    try {
      const response = await fetch(url);
      if (response.ok && (isOurs?.(response) ?? true)) return;
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
