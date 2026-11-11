#!/usr/bin/env node
/**
 * Every Node host in examples/hosts/ type-checked as a user would: `npm ci`
 * from its own lockfile, then its own `npm run typecheck`. No Docker.
 *
 *   pnpm typecheck:hosts                 # every host with a typecheck script
 *   pnpm typecheck:hosts astro nextjs    # some
 *
 * The hosts are not in the pnpm workspace, so `pnpm typecheck` never sees them.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { delimiter, join, sep } from "node:path";

const hostsDir = join(import.meta.dirname, "..", "..", "examples", "hosts");

const typecheck = new Map();
for (const id of readdirSync(hostsDir).sort()) {
  const manifest = join(hostsDir, id, "package.json");
  if (!existsSync(manifest)) continue;
  typecheck.set(id, JSON.parse(readFileSync(manifest, "utf8")).scripts?.typecheck);
}

const args = process.argv.slice(2);
const unknown = args.filter((id) => !typecheck.get(id));
if (unknown.length) {
  const known = [...typecheck].filter(([, script]) => script).map(([id]) => id);
  console.error(`no typecheck script: ${unknown.join(", ")}; hosts: ${known.join(", ")}`);
  process.exit(2);
}
const ids = args.length ? args : [...typecheck].filter(([, script]) => script).map(([id]) => id);
const skipped = [...typecheck].filter(([, script]) => !script).map(([id]) => id);

// pnpm hands its settings down as npm_config_* and puts the workspace's
// node_modules/.bin on PATH: a host must find its tools in its own install.
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^npm_config_/i.test(key)));
env["PATH"] = (process.env["PATH"] ?? "")
  .split(delimiter)
  .filter((dir) => !dir.includes(`node_modules${sep}.bin`))
  .join(delimiter);

const failed = [];
for (const id of ids) {
  console.log(`\n=== ${id}: npm ci && npm run typecheck`);
  const cwd = join(hostsDir, id);
  for (const command of [["ci", "--no-audit", "--no-fund"], ["run", "typecheck"]]) {
    const { status } = spawnSync("npm", command, { cwd, env, stdio: "inherit" });
    if (status !== 0) {
      failed.push(id);
      break;
    }
  }
}

console.log(`\nhosts type-checked: ${ids.length - failed.length}/${ids.length}`);
if (skipped.length && !args.length) console.log(`no typecheck script (no code to check): ${skipped.join(", ")}`);
if (failed.length) {
  console.error(`failed: ${failed.join(", ")}`);
  process.exit(1);
}
