#!/usr/bin/env node
/**
 * The shop demo on every host in examples/hosts/, end to end:
 *
 *   pnpm test:hosts                  # the nine shop flows, one at a time
 *   pnpm test:hosts express nginx    # some
 *   pnpm test:hosts express --https  # express behind Caddy on https://127-0-0-1.sslip.io:8443
 *   pnpm test:hosts --docs           # also refresh the docs' copies (apps/docs/public/hosts/), paced as a person
 *   pnpm test:hosts express --human  # paced as a person, without the docs' copies
 *   pnpm test:hosts express --tour   # also the droplet tour (e2e/tour.spec.ts), before the flow
 *   pnpm test:hosts htmx             # the htmx pages (e2e/htmx.spec.ts), not the shop flow
 *   pnpm test:hosts --keep           # leave the last stack running
 *
 * For each host: `docker compose up --build -d` in its folder, as the
 * compose project `droplets-<host>`, wait until its /gallery and the shop
 * behind it answer, run e2e/shop.spec.ts against it, then
 * `docker compose down -v`. Compose runs on whatever Docker the environment
 * points at. HOSTS_PORT_BASE moves every published port into one block of
 * a hundred: the droplets server on the base, each host on the base plus its
 * default port's last two digits (express, 8003: base + 3).
 *
 * The repository's .env.local, when there is one, is read first; variables
 * already set in the environment win.
 *
 * The video (with a drawn cursor) lands in recordings/<host>.mp4 and the
 * screenshots in recordings/<host>/, both gitignored. `--docs` writes small
 * copies for the docs site: the video at 720p, at most 1 MB
 * (`apps/docs/public/hosts/<host>.mp4`), and the four screenshots as WebP
 * (`apps/docs/public/hosts/<host>/`). Needs ffmpeg. Nothing is uploaded.
 *
 * A recording for the docs is paced as a person (RECORD_PACE=human, see
 * e2e/record.ts): a curved cursor, pauses, typing key by key. Without
 * `--docs` or `--human` the flow runs as fast as the page allows.
 * `--tour` records the droplet tour first (recordings/tour-<host>.mp4);
 * with `--docs` it becomes the docs' `tour.mp4` (the last host's, if several).
 * Its poster, `tour.webp`, is drawn, not recorded: apps/docs/scripts/poster/.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "@dropletsjs/shared/env";

const here = import.meta.dirname;
const root = join(here, "..", "..");

loadEnvLocal();

/**
 * Host id → the shop's URL on it. The id names everything about a host:
 * its folder in examples/hosts/, its docs page, its recordings and its
 * compose project (`droplets-<id>`). A host with `byName` runs only when
 * named (the WordPress showcase, examples/wp-shop).
 * A host with `spec` runs that flow instead of the shop's: `page` is the
 * page to wait for, `shots` its screenshots, and `droplets` says the
 * browser reaches the droplets server directly, on DROPLETS_URL.
 */
const HOSTS = {
  express: { url: "http://localhost:8003" },
  nginx: { url: "http://localhost:8081" },
  fastapi: { url: "http://localhost:8001" },
  sinatra: { url: "http://localhost:8002" },
  php: { url: "http://localhost:8009" },
  wordpress: { url: "http://localhost:8008", byName: true },
  "react-vite": { url: "http://localhost:8004" },
  astro: { url: "http://localhost:8005" },
  sveltekit: { url: "http://localhost:8006" },
  nextjs: { url: "http://localhost:8007" },
  htmx: {
    url: "http://localhost:8010",
    byName: true,
    spec: "e2e/htmx.spec.ts",
    page: "/",
    shots: ["1-swapped", "2-added", "3-login", "4-lazy"],
    droplets: "http://localhost:8000",
  },
};

/** The https variant: a compose override with Caddy in front (examples/hosts/<id>/docker-compose.https.yml). */
const HTTPS = { express: "https://127-0-0-1.sslip.io:8443" };

/** The flow's screenshots (e2e/shop.spec.ts), copied to the docs with --docs. */
const SHOTS = ["1-gallery", "2-cart", "3-admin", "4-out-of-stock"];

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith("--")));
const FLAGS = ["--https", "--docs", "--human", "--tour", "--keep"];
const unknownFlags = [...flags].filter((flag) => !FLAGS.includes(flag));
let names = args.filter((arg) => !arg.startsWith("--"));
if (names.length === 0 || names.includes("all")) names = Object.keys(HOSTS).filter((name) => !HOSTS[name].byName);
const unknown = names.filter((name) => !(name in HOSTS));
if (unknown.length || unknownFlags.length) {
  console.error(`unknown: ${[...unknown, ...unknownFlags].join(", ")}; hosts: ${Object.keys(HOSTS).join(", ")}; flags: ${FLAGS.join(" ")}`);
  process.exit(2);
}
const https = flags.has("--https");

/** The block of ports to publish on (HOSTS_PORT_BASE), or the compose files' defaults. */
const portBase = process.env["HOSTS_PORT_BASE"] ? Number(process.env["HOSTS_PORT_BASE"]) : undefined;
if (portBase !== undefined && !(Number.isInteger(portBase) && portBase >= 1024 && portBase <= 65_435)) {
  console.error(`HOSTS_PORT_BASE=${process.env["HOSTS_PORT_BASE"]}: expected a port from 1024 to 65435`);
  process.exit(2);
}

/** A host's published ports and public URLs, as its compose file reads them. */
function portsOf(name) {
  if (portBase === undefined) {
    return { url: HOSTS[name].url, env: HOSTS[name].droplets ? { DROPLETS_URL: HOSTS[name].droplets } : {} };
  }
  const web = portBase + (Number(new URL(HOSTS[name].url).port) % 100);
  const url = `http://localhost:${web}`;
  return {
    url,
    env: {
      WEB_PORT: String(web),
      WEB_URL: url,
      DROPLETS_PORT: String(portBase),
      DROPLETS_URL: `http://localhost:${portBase}`,
    },
  };
}

if (https) {
  const without = names.filter((name) => !(name in HTTPS));
  if (without.length) {
    console.error(`--https is set up for ${Object.keys(HTTPS).join(", ")} only, not ${without.join(", ")}`);
    process.exit(2);
  }
}

const run = (command, argv, options = {}) => spawnSync(command, argv, { stdio: "inherit", ...options });

/**
 * Until the host's /gallery (or its `page`) answers 200 and a shop fragment
 * comes through its proxy (the SPA's /gallery is its index.html; WordPress
 * redirects to its installer until wordpress-init is done), and, for a host
 * whose browser reaches the droplets server itself, a fragment from there.
 */
async function waitFor(name, url, minutes) {
  const until = Date.now() + minutes * 60_000;
  const direct = HOSTS[name].droplets && portsOf(name).env.DROPLETS_URL;
  let last = "";
  while (Date.now() < until) {
    try {
      if (direct) {
        const droplet = await fetch(`${direct}/droplets/ssr-hydrate`, { signal: AbortSignal.timeout(5000) });
        await droplet.body?.cancel();
        if (droplet.status !== 200) throw new Error(`${direct}: HTTP ${droplet.status}`);
      }
      const page = await fetch(`${url}${HOSTS[name].page ?? "/gallery"}`, { redirect: "manual", signal: AbortSignal.timeout(5000) });
      await page.body?.cancel();
      const fragment = await fetch(`${url}/droplets/product-filter`, {
        headers: { accept: "text/html" },
        redirect: "manual",
        signal: AbortSignal.timeout(5000),
      });
      const body = await fragment.text();
      if (page.status === 200 && fragment.status === 200 && body.includes("<djs-shop")) return true;
      last = `${HOSTS[name].page ?? "/gallery"} HTTP ${page.status}, fragment HTTP ${fragment.status}`;
    } catch (error) {
      last = String(error.cause?.code ?? error.message);
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  console.error(`${url} not ready (${last})`);
  return false;
}

const ffmpeg = (argv) => run("ffmpeg", ["-loglevel", "error", "-y", ...argv]).status === 0;

const DOCS = join(root, "apps", "docs", "public", "hosts");

/** The most a docs video may weigh. */
const MAX_VIDEO_BYTES = 1_000_000;

/**
 * A recording's docs copy: 720p, H.264, no audio, at CRF 28, or the
 * lowest CRF up to 34 that keeps it within MAX_VIDEO_BYTES.
 */
function docsVideo(from, to) {
  for (let crf = 28; crf <= 34; crf++) {
    const ok = ffmpeg([
      "-i", from,
      "-vf", "scale=-2:720", "-c:v", "libx264", "-crf", String(crf), "-preset", "slow",
      "-pix_fmt", "yuv420p", "-an", "-movflags", "+faststart",
      to,
    ]);
    if (!ok) return false;
    const size = statSync(to).size;
    if (size <= MAX_VIDEO_BYTES) return true;
    if (crf === 34) console.warn(`${to}: ${size} bytes at CRF 34, over ${MAX_VIDEO_BYTES}`);
  }
  return true;
}

/** A screenshot's docs copy, as WebP. */
const docsImage = (from, to) => ffmpeg(["-i", from, "-c:v", "libwebp", "-quality", "78", to]);

/** The docs' copies of a host's flow: the video and the screenshots. */
function docsCopies(name) {
  mkdirSync(join(DOCS, name), { recursive: true });
  let ok = docsVideo(join(here, "recordings", `${name}.mp4`), join(DOCS, `${name}.mp4`));
  for (const shot of HOSTS[name].shots ?? SHOTS) {
    ok = docsImage(join(here, "recordings", name, `${shot}.png`), join(DOCS, name, `${shot}.webp`)) && ok;
  }
  if (!ok) console.warn(`${name}: could not write the docs' copies (ffmpeg missing?)`);
  return ok;
}

/** The docs' copy of the droplet tour: tour.mp4. Its poster is drawn (apps/docs/scripts/poster/). */
function docsTour(name) {
  const ok = docsVideo(join(here, "recordings", `tour-${name}.mp4`), join(DOCS, "tour.mp4"));
  if (!ok) console.warn(`${name}: could not write the tour's docs copy (ffmpeg missing?)`);
  return ok;
}

/** Paced as a person for the docs, or when asked. */
const pace = flags.has("--docs") || flags.has("--human") ? { RECORD_PACE: "human" } : {};

/** The host whose stack is up, if any. */
let current;

/** `docker compose` on a host's stack, as the project `droplets-<host>`. */
const compose = (name, files, argv) =>
  run("docker", ["compose", "-p", `droplets-${name}`, ...files, ...argv], {
    cwd: join(root, "examples", "hosts", name),
    env: { ...process.env, ...portsOf(name).env },
  }).status === 0;

/** A stack still up goes down however the run ends. */
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (current) compose(current, ["-f", "docker-compose.yml"], ["down", "-v", "--remove-orphans"]);
    process.exit(130);
  });
}

const results = [];
for (const name of names) {
  const ports = portsOf(name);
  const url = https ? HTTPS[name] : ports.url;
  const files = ["-f", "docker-compose.yml", ...(https ? ["-f", "docker-compose.https.yml"] : [])];
  const recording = https ? `${name}-https` : name;
  console.log(`\n=== ${recording}: ${url}${HOSTS[name].page ?? "/gallery"}`);

  // Ignore the TLS check only where Caddy's internal CA signs the certificate.
  const env = { ...process.env, ...(https ? { NODE_TLS_REJECT_UNAUTHORIZED: "0" } : {}) };
  current = name;
  let ok = compose(name, files, ["up", "--build", "-d"]);
  // This process polls the https stack too.
  if (https) process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";
  ok = ok && (await waitFor(name, url, 10));
  // The flow's own spec, or every spec (the shop's; the others skip themselves).
  const specs = HOSTS[name].spec ? [HOSTS[name].spec] : [];
  if (ok && flags.has("--tour") && HOSTS[name].spec) {
    console.warn(`${name}: no droplet tour, its flow is ${HOSTS[name].spec}`);
  } else if (ok && flags.has("--tour")) {
    // First, while the shop is as seeded.
    ok = run("pnpm", ["exec", "playwright", "test"], {
      cwd: here,
      env: { ...env, ...pace, TOUR: "1", HOST_NAME: recording, HOST_URL: url },
    }).status === 0;
    if (ok && flags.has("--docs") && !https) ok = docsTour(name);
  }
  if (ok) {
    ok = run("pnpm", ["exec", "playwright", "test", ...specs], {
      cwd: here,
      env: { ...env, ...ports.env, ...pace, HOST_NAME: recording, HOST_URL: url },
    }).status === 0;
    if (ok && flags.has("--docs") && !https) ok = docsCopies(name);
  } else {
    compose(name, files, ["logs", "--tail", "40"]);
  }
  if (!flags.has("--keep") || name !== names.at(-1)) {
    compose(name, files, ["down", "-v", "--remove-orphans"]);
    current = undefined;
  }
  const video = join(here, "recordings", `${recording}.mp4`);
  results.push({ host: recording, ok, video: existsSync(video) ? video : "-" });
}

if (current) console.log(`\n${current} stays up: docker compose -p droplets-${current} down -v, in examples/hosts/${current}`);

console.log("\nhost\tresult\tvideo");
for (const { host, ok, video } of results) console.log(`${host}\t${ok ? "pass" : "FAIL"}\t${video}`);
process.exit(results.every((result) => result.ok) ? 0 : 1);
