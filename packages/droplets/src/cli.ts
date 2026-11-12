#!/usr/bin/env node
/**
 * `djs`: the droplets command.
 *
 * - `sync` writes `.droplets/` (the `./$types` of every droplet) without
 *   starting Vite's dev server or a build, for type checks on a fresh
 *   checkout: `"prepare": "djs sync"`.
 * - `add` writes a new droplet folder, asking for what its flags leave out.
 */
import { parseArgs } from "node:util";
import { loadProject, type ProjectOptions } from "./add/project.ts";

const USAGE = `Usage: djs <command> [--root <dir>] [--config <vite config>] [--mode <mode>]

  sync         Write .droplets/: the ./$types of every droplet, and the tsconfig
               that maps them. vite dev and vite build write them too.

  add [name]   Write src/droplets/<name>/, asking for what the options leave out:
    --framework  svelte | vue | react | preact | solid | hono-jsx | handlebars | lit | script
                 one the Vite config lacks is installed and added to renderers;
                 script (+droplet.script.ts, plain browser code) is built in
    --target     full (default) | ssr | client | ssg; not for script
    --hydrate    always | visible | interactive | none
                 full asks; the other targets imply it; not for script
    --with       server,universal,error,css: the optional files
    --pm         npm | pnpm | yarn | bun | deno (default: the one running djs)
    --yes        ask nothing; accept the warnings`;

async function sync(options: ProjectOptions): Promise<void> {
  const { api } = await loadProject(options);
  await api.syncTypes();
  const count = api.droplets().length;
  console.log(`droplets: .droplets/ written for ${count} droplet${count === 1 ? "" : "s"}`);
}

type MainInput = { argv: string[] };

async function main({ argv }: MainInput): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      root: { type: "string" },
      config: { type: "string" },
      mode: { type: "string" },
      framework: { type: "string" },
      target: { type: "string" },
      hydrate: { type: "string" },
      with: { type: "string" },
      pm: { type: "string" },
      yes: { type: "boolean", short: "y" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command, ...rest] = positionals;
  if (values.help || !command) {
    console.log(USAGE);
    return values.help ? 0 : 1;
  }
  if (command === "sync") {
    await sync(values);
    return 0;
  }
  if (command === "add") {
    // Loaded here: the prompts are for `add` only.
    const { runAdd } = await import("./add/add.ts");
    await runAdd({ name: rest[0], flags: values });
    return 0;
  }
  console.error(`djs: unknown command "${command}"\n\n${USAGE}`);
  return 1;
}

main({ argv: process.argv.slice(2) }).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(`djs: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
