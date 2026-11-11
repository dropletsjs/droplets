/**
 * `djs add <name>`: a new droplet folder. Asks for what the flags do not
 * say (framework, target, when a `full` droplet hydrates, optional files),
 * installs and registers a framework the project does not use yet, writes
 * the files, then `./$types` (`djs sync`).
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { styleText } from "node:util";
import * as prompts from "@clack/prompts";
import { kebabCase } from "case-anything";
import { ADD_KINDS, FRAMEWORKS, frameworkNamed, kindNamed, packageName, SCRIPT, type Framework } from "./catalog.ts";
import {
  FULL_HYDRATE,
  HYDRATE_CHOICES,
  SCRIPT_HYDRATE,
  TARGETS,
  flagsFor,
  scriptFlags,
  type Flags,
  type HydrateChoice,
  type Note,
  type Target,
} from "./flags.ts";
import { coreVersion, detectPackageManager, installCommand, isInstalled, PACKAGE_MANAGERS, run, type PackageManager } from "./install.ts";
import { loadProject, type Project, type ProjectOptions } from "./project.ts";
import { DROPLET_FILES, dropletFileChoices, dropletFiles, type DropletFile } from "./templates.ts";
import { withJsx } from "./tsconfig.ts";
import { addRenderer, manualSteps } from "./vite-config.ts";

export type AddChoices = {
  name: string;
  framework: Framework;
  flags: Flags;
  files: ReadonlySet<DropletFile>;
};

export type AddSteps = {
  pm: PackageManager;
  /** Runs an install command; tests pass a fake. */
  runner?: (command: [string, ...string[]], root: string) => Promise<void>;
  log?: (message: string) => void;
};

export type AddResult = {
  /** The droplet folder, relative to the project root. */
  folder: string;
  written: string[];
  /** The packages installed, as specs. */
  installed: string[];
  /** The config files changed: `vite.config.ts`, `tsconfig.json`. */
  edited: string[];
  /** What to add to the Vite config by hand, when `djs add` could not. */
  manual?: string;
};

/** Why `name` cannot be a new droplet, or `undefined` when it can. */
export function nameProblem(name: string, project: Pick<Project, "api">): string | undefined {
  if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(name)) return "letters, digits and dashes, starting with a letter: hello-world";
  const id = kebabCase(name);
  if (project.api.droplets().some((droplet) => droplet.id === id)) return `a droplet with the id "${id}" exists already`;
  if (existsSync(join(project.api.dropletsRoot(), name))) return `${name}/ exists already`;
  return undefined;
}

/**
 * The packages `framework` needs that the project lacks, as dependencies and
 * dev dependencies. The renderer is pinned to `version`, the core's.
 */
export function missingPackages(
  root: string,
  framework: Framework,
  version: string | undefined = coreVersion(root),
): { dependencies: string[]; devDependencies: string[] } {
  const missing = (specs: string[]) => specs.filter((spec) => !isInstalled(root, packageName(spec)));
  const renderer = version ? `${framework.package}@${version}` : framework.package;
  return {
    dependencies: missing(framework.dependencies),
    devDependencies: missing([renderer, ...framework.devDependencies]),
  };
}

/** Installs and registers the framework when needed, writes the droplet and its `./$types`. */
export async function addDroplet(project: Project, choices: AddChoices, steps: AddSteps): Promise<AddResult> {
  const log = steps.log ?? (() => {});
  const runner = steps.runner ?? run;
  const { root, api } = project;
  const result: AddResult = { folder: "", written: [], installed: [], edited: [] };
  const { framework } = choices;

  if (!framework.builtIn && !api.renderers().includes(framework.name)) {
    const { dependencies, devDependencies } = missingPackages(root, framework);
    for (const [specs, dev] of [
      [dependencies, false],
      [devDependencies, true],
    ] as const) {
      if (specs.length === 0) continue;
      const command = installCommand(steps.pm, specs, dev);
      log(`$ ${command.join(" ")}`);
      await runner(command, root);
      result.installed.push(...specs);
    }
    const configFile = project.configFile;
    const edit = configFile ? addRenderer(await readFile(configFile, "utf8"), configFile, framework) : { manual: manualSteps(framework) };
    if ("code" in edit && configFile) {
      await writeFile(configFile, edit.code);
      result.edited.push(relative(root, configFile));
    } else if ("manual" in edit) {
      result.manual = edit.manual;
    }
    if (framework.jsxImportSource) {
      const tsconfig = join(root, "tsconfig.json");
      const code = await withJsx(tsconfig, framework.jsxImportSource);
      if (code !== undefined) {
        await writeFile(tsconfig, code);
        result.edited.push("tsconfig.json");
      }
    }
  }

  const folder = join(api.dropletsRoot(), choices.name);
  result.folder = relative(root, folder);
  await mkdir(folder, { recursive: true });
  for (const [file, content] of Object.entries(dropletFiles(choices))) {
    await writeFile(join(folder, file), content, { flag: "wx" });
    result.written.push(join(result.folder, file));
  }

  // The renderer has to be in the config before the droplet can be typed.
  if (!result.manual) {
    const fresh = await loadProject({ root, ...(project.configFile ? { config: project.configFile } : {}) });
    await fresh.api.syncTypes();
  }
  return result;
}

export type AddFlags = ProjectOptions & {
  framework?: string;
  target?: string;
  hydrate?: string;
  with?: string;
  pm?: string;
  yes?: boolean;
};

const dim = (text: string) => styleText("dim", text);

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[], flag: string): T | undefined {
  if (value === undefined) return undefined;
  if ((allowed as readonly string[]).includes(value)) return value as T;
  throw new Error(`--${flag} ${value}: expected ${allowed.join(", ")}`);
}

/** Ends the command when a prompt was cancelled (ctrl-c, escape). */
function answer<T>(value: T): Exclude<T, symbol> {
  if (prompts.isCancel(value)) {
    prompts.cancel("Nothing written.");
    process.exit(1);
  }
  return value as Exclude<T, symbol>;
}

/** The command: the flags, then prompts for the rest when the terminal is interactive. */
export async function runAdd(name: string | undefined, flags: AddFlags): Promise<void> {
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY) && !flags.yes;
  const project = await loadProject(flags);
  const configured = new Set(project.api.renderers());
  const pm = oneOf(flags.pm, PACKAGE_MANAGERS, "pm") ?? detectPackageManager(project.root);
  const target = oneOf(
    flags.target,
    TARGETS.map((t) => t.value),
    "target",
  );
  const hydrate = oneOf(flags.hydrate, HYDRATE_CHOICES, "hydrate");
  const files = flags.with?.split(",").flatMap(
    (file) =>
      oneOf(
        file.trim(),
        DROPLET_FILES.map((f) => f.value),
        "with",
      ) ?? [],
  );
  const needsAnswer = (what: string) => new Error(`${what} (or run djs add in a terminal to be asked)`);

  /** A warning: confirmed when interactive, accepted with --yes, an error otherwise. */
  const accept = async (message: string) => {
    if (flags.yes) return prompts.log.warn(message);
    if (!interactive) throw needsAnswer(`${message}; pass --yes to go ahead`);
    prompts.log.warn(message);
    if (!answer(await prompts.confirm({ message: "Go ahead?" }))) {
      prompts.cancel("Nothing written.");
      process.exit(1);
    }
  };

  if (interactive) prompts.intro("djs add");

  if (name === undefined && !interactive) throw needsAnswer("name the droplet: djs add <name>");
  const dropletName =
    name ??
    answer(
      await prompts.text({
        message: "Droplet name",
        placeholder: "hello-world",
        validate: (value) => nameProblem(value ?? "", project),
      }),
    );
  const problem = nameProblem(dropletName, project);
  if (problem) throw new Error(`${dropletName}: ${problem}`);

  let framework: Framework | undefined;
  if (flags.framework) {
    framework = kindNamed(flags.framework);
    if (!framework) throw new Error(`--framework ${flags.framework}: expected ${ADD_KINDS.map((f) => f.name).join(", ")}`);
  } else if (!interactive) {
    if (configured.size !== 1) throw needsAnswer(`pick a framework: --framework ${ADD_KINDS.map((f) => f.name).join("|")}`);
    const [only] = configured;
    if (only !== undefined) framework = frameworkNamed(only);
  } else {
    const ordered = [...FRAMEWORKS].sort((a, b) => Number(configured.has(b.name)) - Number(configured.has(a.name)));
    const picked = answer(
      await prompts.select({
        message: "Framework",
        options: [
          ...ordered.map((f) =>
            configured.has(f.name)
              ? { value: f.name, label: f.label }
              : { value: f.name, label: dim(f.label), hint: "not in vite.config: adds it" },
          ),
          { value: SCRIPT.name, label: SCRIPT.label, hint: "built in: runs in the browser with (data, el), renders nothing on the server" },
        ],
      }),
    );
    framework = kindNamed(picked);
  }
  if (!framework) throw new Error("no framework");
  if (framework.builtIn) {
    // A script droplet: no target, no renderer to install, `always` or `visible`.
    if (target !== undefined)
      throw new Error("--target does not apply to a script droplet: it renders nothing on the server and always runs in the browser");
    const chosen =
      hydrate ??
      (interactive
        ? answer(
            await prompts.select({
              message: "Runs",
              options: SCRIPT_HYDRATE.map((h) => ({ ...h })),
              initialValue: "always" as HydrateChoice,
            }),
          )
        : "always");
    const flags = scriptFlags(chosen);
    if (files?.includes("error")) throw new Error("--with error: a script droplet has no error page; it renders nothing");
    const choices = dropletFileChoices(framework);
    const chosenFiles =
      files ??
      (interactive
        ? answer(
            await prompts.multiselect({
              message: "Optional files",
              options: choices.map((f) => ({ value: f.value, label: f.label, hint: f.hint })),
              required: false,
            }),
          )
        : []);
    const result = await addDroplet(
      project,
      { name: dropletName, framework, flags, files: new Set(chosenFiles) },
      { pm, log: (message) => prompts.log.step(message) },
    );
    return report(result, dropletName, interactive);
  }
  if (!configured.has(framework.name)) {
    const { dependencies, devDependencies } = missingPackages(project.root, framework);
    const specs = [...dependencies, ...devDependencies].map(packageName);
    const install = specs.length > 0 ? `this will install ${specs.join(", ")} and ` : "this will ";
    await accept(`${install}add ${framework.factory}() to renderers in vite.config`);
  }

  const chosenTarget =
    target ??
    (interactive
      ? answer(await prompts.select({ message: "Target", options: TARGETS.map((t) => ({ ...t })), initialValue: "full" as Target }))
      : "full");
  let chosenHydrate: HydrateChoice | undefined = hydrate;
  if (chosenHydrate === undefined && chosenTarget === "full" && interactive) {
    chosenHydrate = answer(
      await prompts.select({ message: "Hydrate", options: FULL_HYDRATE.map((h) => ({ ...h })), initialValue: "always" as HydrateChoice }),
    );
  }
  const { flags: dropletFlags, notes } = flagsFor(chosenTarget, chosenHydrate);
  for (const note of notes.filter((n: Note) => n.level === "info")) prompts.log.info(note.message);
  for (const note of notes.filter((n: Note) => n.level === "warn")) await accept(note.message);

  const chosenFiles =
    files ??
    (interactive
      ? answer(
          await prompts.multiselect({
            message: "Optional files",
            options: DROPLET_FILES.map((f) => ({ value: f.value, label: f.label, hint: f.hint })),
            required: false,
          }),
        )
      : []);

  const result = await addDroplet(
    project,
    { name: dropletName, framework, flags: dropletFlags, files: new Set(chosenFiles) },
    { pm, log: (message) => prompts.log.step(message) },
  );
  report(result, dropletName, interactive);
}

/** What was written and changed, and where to see the droplet. */
function report(result: AddResult, dropletName: string, interactive: boolean): void {
  for (const file of result.edited) prompts.log.success(`updated ${file}`);
  for (const file of result.written) prompts.log.success(`created ${file}`);
  if (result.manual) {
    prompts.log.warn(`vite.config could not be updated; add the renderer by hand, then run djs sync:\n${result.manual}`);
  }
  const id = kebabCase(dropletName);
  const next = `${result.folder}/ is ready: vite dev, then /?droplet=${id} or /droplets/${id}`;
  if (interactive) prompts.outro(next);
  else prompts.log.info(next);
}
