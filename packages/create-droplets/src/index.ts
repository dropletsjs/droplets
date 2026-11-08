/**
 * `npm create droplets [folder]`: a new Droplets project. Asks for what the
 * flags leave out (folder, element, frameworks, adapters, Tailwind, the dev
 * tool on external hosts, Claude, the package manager), writes the files,
 * installs, writes `.droplets/` (`djs sync`, run here: Deno skips lifecycle
 * scripts) and makes the first git commit.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import * as prompts from "@clack/prompts";
import {
  ADAPTERS,
  commands,
  elementProblem,
  packageNameFor,
  parseFlags,
  suggestElement,
  USAGE,
  type Adapter,
  type Choices,
  type Flags,
} from "./choices.ts";
import { projectFiles } from "./files.ts";
import { detectPackageManager, FRAMEWORKS, frameworkNamed, PACKAGE_MANAGERS, run, type PackageManager } from "./shared.ts";

/** Ends the command when a prompt was cancelled (ctrl-c, escape). */
function answer<T>(value: T): Exclude<T, symbol> {
  if (prompts.isCancel(value)) {
    prompts.cancel("Nothing written.");
    process.exit(1);
  }
  return value as Exclude<T, symbol>;
}

const isEmpty = (dir: string) => !existsSync(dir) || readdirSync(dir).length === 0;

/** The choices: the flags, then prompts for the rest, or errors without a terminal. */
async function choose(flags: Flags, interactive: boolean): Promise<Choices> {
  const needs = (what: string) => new Error(`${what} (or run it in a terminal to be asked)`);

  if (flags.folder === undefined && !interactive) throw needs("name the folder: npm create droplets <folder>");
  const folder =
    flags.folder ??
    answer(
      await prompts.text({
        message: "Project folder",
        placeholder: "my-droplets",
        defaultValue: "my-droplets",
      }),
    );
  if (!isEmpty(resolve(folder))) {
    if (!interactive) throw new Error(`${folder} is not empty; pick another folder`);
    const go = answer(await prompts.confirm({ message: `${folder} is not empty. Write into it anyway?`, initialValue: false }));
    if (!go) {
      prompts.cancel("Nothing written.");
      process.exit(1);
    }
  }

  const element =
    flags.element ??
    (interactive
      ? answer(
          await prompts.text({
            message: "Custom element name (every droplet renders in it)",
            initialValue: suggestElement(folder),
            validate: (value) => elementProblem(value ?? ""),
          }),
        )
      : suggestElement(folder));

  if (flags.frameworks === undefined && !interactive) throw needs(`pick the frameworks: --frameworks ${FRAMEWORKS.map((f) => f.name).join(",")}`);
  const frameworks =
    flags.frameworks ??
    answer(
      await prompts.multiselect({
        message: "Frameworks",
        options: FRAMEWORKS.map((f) => ({ value: f.name, label: f.label })),
        required: true,
      }),
    ).map((name) => frameworkNamed(name)!);

  const adapters: Adapter[] =
    flags.adapters ??
    (interactive
      ? answer(
          await prompts.multiselect({
            message: "Adapters (where the build runs)",
            options: ADAPTERS.map((a) => ({ value: a.value, label: a.label, hint: a.hint })),
            initialValues: ["node" as Adapter],
            required: true,
          }),
        )
      : ["node"]);

  const tailwind =
    flags.tailwind ?? (interactive ? answer(await prompts.confirm({ message: "Tailwind CSS?", initialValue: false })) : false);
  const injectTool =
    flags.injectTool ??
    (interactive
      ? answer(await prompts.confirm({ message: "Inject the dev tool in external hosts?", initialValue: false }))
      : false);
  const claude =
    flags.claude ?? (interactive ? answer(await prompts.confirm({ message: "Using Claude? (adds CLAUDE.md)", initialValue: false })) : false);

  const detected = detectPackageManager(process.cwd());
  const pm: PackageManager =
    flags.pm ??
    (interactive
      ? answer(
          await prompts.select({
            message: "Package manager",
            options: PACKAGE_MANAGERS.map((value) => ({ value, label: value })),
            initialValue: detected,
          }),
        )
      : detected);

  return {
    folder,
    name: packageNameFor(folder),
    element,
    frameworks: FRAMEWORKS.filter((f) => frameworks.includes(f)),
    adapters: ADAPTERS.map((a) => a.value).filter((a) => adapters.includes(a)),
    tailwind,
    injectTool,
    claude,
    pm,
  };
}

/** Writes every file, refusing to replace one that exists. */
async function write(root: string, files: Record<string, string>): Promise<void> {
  const taken = Object.keys(files).filter((file) => existsSync(join(root, file)));
  if (taken.length > 0) throw new Error(`these files exist already: ${taken.join(", ")}`);
  for (const [file, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), content, { flag: "wx" });
  }
}

/** `git init` and the first commit; a warning, not a failure, when git cannot. */
function initGit(root: string): string | undefined {
  const git = (...args: string[]) => spawnSync("git", args, { cwd: root, encoding: "utf8" });
  const inside = git("rev-parse", "--is-inside-work-tree");
  if (inside.error) return "git is not installed: no repository created";
  if (inside.status === 0 && inside.stdout.trim() === "true") return "already inside a git repository: no new one created";
  for (const args of [["init", "-q"], ["add", "-A"], ["commit", "-q", "-m", "Initial commit from create-droplets"]]) {
    const result = git(...args);
    if (result.status !== 0) return `git ${args[0]} failed: ${(result.stderr || result.stdout).trim().split("\n")[0]}`;
  }
  return undefined;
}

async function main(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  if (flags.help) {
    console.log(USAGE);
    return;
  }
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY) && !flags.yes;
  if (interactive) prompts.intro("create-droplets");
  const choices = await choose(flags, interactive);
  const root = resolve(choices.folder);
  const { install, run: runScript } = commands(choices.pm);

  await write(root, projectFiles(choices));
  prompts.log.success(`wrote ${relative(process.cwd(), root) || "."}/ (${choices.frameworks.map((f) => f.label).join(", ")})`);

  let installed = false;
  if (flags.install) {
    const [command, ...args] = install.split(" ") as [string, ...string[]];
    try {
      prompts.log.step(`$ ${install}`);
      await run([command, ...args], root);
      installed = true;
      // `prepare` runs it too, but not under every package manager (Deno skips lifecycle scripts).
      prompts.log.step(`$ ${runScript} sync`);
      const [runner, ...rest] = runScript.split(" ") as [string, ...string[]];
      await run([runner, ...rest, "sync"], root);
    } catch (error) {
      prompts.log.warn(`${error instanceof Error ? error.message : String(error)}; run \`${installed ? `${runScript} sync` : install}\` yourself`);
    }
  }
  if (flags.git) {
    const problem = initGit(root);
    if (problem) prompts.log.warn(problem);
    else prompts.log.success("git: initial commit");
  }

  const steps = [
    ...(root === process.cwd() ? [] : [`cd ${relative(process.cwd(), root)}`]),
    ...(installed ? [] : [install]),
    `${runScript} dev`,
    "open http://localhost:5173/",
  ];
  prompts.note(steps.join("\n"), "Next");
  if (interactive) prompts.outro("AGENTS.md has the conventions; the guide is at https://dropletsjs.dev");
}

main(process.argv.slice(2)).then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(`create-droplets: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
