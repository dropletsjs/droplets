/**
 * Installing a renderer and its framework with the project's package
 * manager: the one running `djs` (`npm_config_user_agent`), else the one
 * whose lockfile is nearest, else npm.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun" | "deno";

export const PACKAGE_MANAGERS: readonly PackageManager[] = ["npm", "pnpm", "yarn", "bun", "deno"];

const LOCKFILES: [string, PackageManager][] = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["deno.lock", "deno"],
  ["package-lock.json", "npm"],
];

type FromUserAgentInput = { agent: string | undefined };

export type InstallCommandInput = { pm: PackageManager; specs: readonly string[]; isDev: boolean };

export type IsInstalledInput = { root: string; name: string };

type ReadCoreVersionInput = { file: string };

export type CoreVersionInput = { root: string };

/** `pnpm/10.18.0 npm/? node/v24.9.0 darwin arm64` → `pnpm`. */
function fromUserAgent({ agent }: FromUserAgentInput): PackageManager | undefined {
  const name = agent?.split("/")[0];
  return PACKAGE_MANAGERS.find((pm) => pm === name);
}

export type DetectPackageManagerInput = { root: string; agent?: string | undefined };

/** The package manager running this command, else the one whose lockfile sits in `root` or above, else npm. */
export function detectPackageManager({ root, agent = process.env["npm_config_user_agent"] }: DetectPackageManagerInput): PackageManager {
  const running = fromUserAgent({ agent });
  if (running) return running;
  for (let dir = root; ; dir = dirname(dir)) {
    const found = LOCKFILES.find(([file]) => existsSync(join(dir, file)));
    if (found) return found[1];
    if (dirname(dir) === dir) return "npm";
  }
}

/** The command that adds `specs` (`react@^19.0.0`) to the project, as dependencies or dev dependencies. */
export function installCommand({ pm, specs, isDev }: InstallCommandInput): [string, ...string[]] {
  switch (pm) {
    case "npm":
      return ["npm", "install", ...(isDev ? ["--save-dev"] : []), ...specs];
    case "pnpm":
      return ["pnpm", "add", ...(isDev ? ["--save-dev"] : []), ...specs];
    case "yarn":
      return ["yarn", "add", ...(isDev ? ["--dev"] : []), ...specs];
    case "bun":
      return ["bun", "add", ...(isDev ? ["--dev"] : []), ...specs];
    case "deno":
      return ["deno", "add", ...(isDev ? ["--dev"] : []), ...specs.map((spec) => `npm:${spec}`)];
    default: {
      const unreachable: never = pm;
      return unreachable;
    }
  }
}

/** Whether `name` is in a `node_modules` the project resolves from. */
export function isInstalled({ root, name }: IsInstalledInput): boolean {
  for (let dir = root; ; dir = dirname(dir)) {
    if (existsSync(join(dir, "node_modules", name, "package.json"))) return true;
    if (dirname(dir) === dir) return false;
  }
}

const CORE = "@dropletsjs/droplets";

function readCoreVersion({ file }: ReadCoreVersionInput): string | undefined {
  try {
    const pkg = JSON.parse(readFileSync(file, "utf8")) as { name?: unknown; version?: unknown };
    return pkg.name === CORE && typeof pkg.version === "string" ? pkg.version : undefined;
  } catch {
    // No package.json there, or not one that parses: look further up.
    return undefined;
  }
}

/**
 * The version of the core the project has installed, else of the core
 * running `djs`. Every `@dropletsjs/*` package is released at the same
 * version, so a renderer is installed at exactly this one: a registry with
 * only prereleases resolves it, and it matches the core it plugs into.
 */
export function coreVersion({ root }: CoreVersionInput): string | undefined {
  for (let dir = root; ; dir = dirname(dir)) {
    const version = readCoreVersion({ file: join(dir, "node_modules", CORE, "package.json") });
    if (version) return version;
    if (dirname(dir) === dir) break;
  }
  for (let dir = dirname(fileURLToPath(import.meta.url)); ; dir = dirname(dir)) {
    const version = readCoreVersion({ file: join(dir, "package.json") });
    if (version) return version;
    if (dirname(dir) === dir) return undefined;
  }
}

export type RunInput = { argv: [string, ...string[]]; root: string };

/** Runs `argv` in `root`, its output on the terminal. Rejects when it fails. */
export function run({ argv: [command, ...args], root }: RunInput): Promise<void> {
  // Windows runs `npm` and the others through their `.cmd` shims, which need a shell.
  const windows = process.platform === "win32";
  const quoted = windows ? args.map((arg) => (/[\s^&|<>]/.test(arg) ? `"${arg}"` : arg)) : args;
  return new Promise((done, fail) => {
    const child = spawn(command, quoted, { cwd: root, stdio: "inherit", shell: windows });
    child.on("error", fail);
    child.on("exit", (code) => (code === 0 ? done() : fail(new Error(`${command} ${args.join(" ")} exited with ${code}`))));
  });
}
