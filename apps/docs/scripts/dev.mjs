// `pnpm docs:dev`: the demo's dev server (apps/demo, http://localhost:5180)
// and `astro dev` side by side, so the live droplets render and hydrate
// locally: the pages fetch their fragments from the demo's dev server and
// the browser loads /index.js from it. Ctrl-C stops both.
//
// The demo trusts the docs' origins only (apps/demo/src/lib/origins.ts):
// the port astro dev starts on (`--port`, 4321 by default) goes to it as
// DOCS_PORT, so `pnpm docs:dev --port 4400` can embed and post too.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const DEMO = "http://localhost:5180";

/** `--port 4400` or `--port=4400` among the arguments for astro dev, else Astro's 4321. */
const astroArgs = process.argv.slice(2);
const portArg = astroArgs.findIndex((arg) => arg === "--port" || arg.startsWith("--port="));
const DOCS_PORT =
  portArg === -1 ? "4321" : (astroArgs[portArg].split("=")[1] ?? astroArgs[portArg + 1] ?? "4321");
const demoDir = fileURLToPath(new URL("../../demo/", import.meta.url));
const docsDir = fileURLToPath(new URL("..", import.meta.url));

const children = [];
const stopAll = (code) => {
  for (const child of children) if (child.exitCode === null) child.kill("SIGTERM");
  process.exit(code);
};
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stopAll(130));

const start = (name, command, args, cwd, env = {}) => {
  const child = spawn(command, args, { cwd, stdio: "inherit", env: { ...process.env, ...env } });
  child.on("exit", (code) => {
    console.error(`[docs:dev] ${name} exited (${code ?? "signal"}); stopping`);
    stopAll(code ?? 1);
  });
  children.push(child);
};

start("the demo dev server", "pnpm", ["run", "dev"], demoDir, { DOCS_PORT });

// The pages render on request: wait for the demo, so the first one has it.
const deadline = Date.now() + 30_000;
for (;;) {
  try {
    if ((await fetch(`${DEMO}/health`)).ok) break;
  } catch {
    // not up yet
  }
  if (Date.now() > deadline) {
    console.error(`[docs:dev] the demo dev server did not answer ${DEMO}/health within 30 s`);
    stopAll(1);
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
}

start("astro dev", "pnpm", ["exec", "astro", "dev", ...astroArgs], docsDir, {
  DEMO_URL: DEMO,
  DEMO_PUBLIC_URL: DEMO,
});
