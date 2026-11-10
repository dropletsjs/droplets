// Runs a command with the demo server (apps/demo) up, for the live droplets
// the pages inline at build (src/components/live-droplet.ts):
//
//   node scripts/with-demo.mjs astro build    # `pnpm docs:build`
//
// It builds apps/demo for Node, starts dist/server.js on a free local port
// with a DROPLETS_SECRET made for this run, waits for /health, runs the
// command with DEMO_URL pointing at it, and stops the server. Anything that
// goes wrong fails loudly: no page is built without its droplets.
//
// With DEMO_URL already set (a deployed demo: DEMO_URL=https://demo.dropletsjs.dev),
// nothing is built or started and the command runs against that server.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

const demo = fileURLToPath(new URL("../../demo/", import.meta.url));
const command = process.argv.slice(2);
if (command.length === 0) {
  console.error("usage: node scripts/with-demo.mjs <command…>");
  process.exit(2);
}

const fail = (message) => {
  console.error(`\n[with-demo] ${message}\n`);
  process.exit(1);
};

/** Runs the command with `env` and exits with its status. */
function run(env) {
  const child = spawnSync(command[0], command.slice(1), { stdio: "inherit", env: { ...process.env, ...env }, shell: false });
  if (child.error) fail(`could not run ${command[0]}: ${child.error.message}`);
  return child.status ?? 1;
}

if (process.env.DEMO_URL) {
  console.log(`[with-demo] using the demo server at ${process.env.DEMO_URL}`);
  process.exit(run({}));
}

const publicUrl = new URL(process.env.DEMO_PUBLIC_URL || "https://demo.dropletsjs.dev");

// 1. Build the demo for Node.
if (!existsSync(fileURLToPath(new URL("../../../packages/droplets/dist/vite.js", import.meta.url)))) {
  fail("the droplets packages are not built: run `pnpm build` at the repository root first");
}
console.log("[with-demo] building apps/demo (node)…");
const build = spawnSync("pnpm", ["run", "build"], { cwd: demo, stdio: "inherit", env: { ...process.env, DROPLETS_ADAPTER: "node" } });
if (build.status !== 0) fail("the demo build failed");

// 2. Start it on a free port.
const port = await new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});
const base = `http://127.0.0.1:${port}`;
let log = "";
const server = spawn(process.execPath, ["dist/server.js"], {
  cwd: demo,
  env: {
    ...process.env,
    PORT: String(port),
    // For this run only: the build never posts a form, but the server
    // should run as deployed, with a secret of 32 random bytes.
    DROPLETS_SECRET: randomBytes(32).toString("base64url"),
    // The fragments are requested with `x-host: <DEMO_PUBLIC_URL>`, so the
    // URLs they write are where browsers reach the demo: trust that origin.
    DROPLETS_TRUSTED_ORIGINS: publicUrl.origin,
    DROPLETS_LOG: "warn",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (chunk) => (log += chunk));
server.stderr.on("data", (chunk) => (log += chunk));
const stop = () => {
  if (server.exitCode === null) server.kill("SIGTERM");
};
process.on("exit", stop);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => process.exit(130));

// 3. Wait for it.
const deadline = Date.now() + 20_000;
for (;;) {
  if (server.exitCode !== null) fail(`the demo server exited (${server.exitCode}):\n${log}`);
  try {
    if ((await fetch(`${base}/health`)).ok) break;
  } catch {
    // not listening yet
  }
  if (Date.now() > deadline) fail(`the demo server did not answer ${base}/health within 20 s:\n${log}`);
  await new Promise((resolve) => setTimeout(resolve, 150));
}
console.log(`[with-demo] demo server on ${base}, public as ${publicUrl.origin}`);

// 4. The command, then stop.
const status = run({ DEMO_URL: base, DEMO_PUBLIC_URL: publicUrl.href });
stop();
if (status !== 0 && log.trim()) console.error(`[with-demo] the demo server's log:\n${log}`);
process.exit(status);
