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
import { dropletId } from "../core/discover.ts";
import {
  ADD_CONFIRMATION_NEEDED,
  ADD_FLAG_VALUE_INVALID,
  ADD_FRAMEWORK_MISSING,
  ADD_NAME_INVALID,
  ADD_NAME_MISSING,
  ADD_OPTION_NOT_FOR_SCRIPT,
  ADD_RENDERER_INSTALL,
  ADD_VITE_CONFIG_NOT_UPDATED,
} from "../errors/cli.ts";
import { dropletsError, formatMessage } from "../errors/format.ts";
import { ADD_KINDS, FRAMEWORKS, frameworkNamed, kindNamed, packageName, SCRIPT, type Framework } from "./catalog.ts";
import { FULL_HYDRATE, HYDRATE_CHOICES, TARGETS, flagsFor, scriptFlags, type Flags, type HydrateChoice, type Target } from "./flags.ts";
import {
  coreVersion,
  detectPackageManager,
  installCommand,
  isInstalled,
  PACKAGE_MANAGERS,
  run,
  type PackageManager,
  type RunInput,
} from "./install.ts";
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
  runner?: (input: RunInput) => Promise<void>;
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

export type NameProblemInput = { name: string; project: Pick<Project, "api"> };

export type MissingPackagesInput = { root: string; framework: Framework; version?: string | undefined };

export type MissingPackages = { dependencies: string[]; devDependencies: string[] };

export type AddDropletInput = { project: Project; choices: AddChoices; steps: AddSteps };

type OneOfInput<T extends string> = { value: string | undefined; allowed: readonly T[]; flag: string };

type AnswerInput<T> = { value: T };

export type RunAddInput = { name: string | undefined; flags: AddFlags };

type ReportInput = { result: AddResult; dropletName: string; interactive: boolean };

/** Why `name` cannot be a new droplet, or `undefined` when it can. */
export function nameProblem({ name, project }: NameProblemInput): string | undefined {
  if (!/^[a-z]/.test(name) || dropletId({ folderName: name }) === null) return "lowercase kebab-case, starting with a letter: hello-world";
  if (project.api.droplets().some((droplet) => droplet.id === name)) return `a droplet with the id "${name}" exists already`;
  if (existsSync(join(project.api.dropletsRoot(), name))) return `${name}/ exists already`;
  return undefined;
}

/**
 * The packages `framework` needs that the project lacks, as dependencies and
 * dev dependencies. The renderer is pinned to `version`, the core's.
 */
export function missingPackages({ root, framework, version = coreVersion({ root }) }: MissingPackagesInput): MissingPackages {
  const missing = (specs: string[]): string[] => specs.filter((spec) => !isInstalled({ root, name: packageName({ spec }) }));
  const renderer = version ? `${framework.package}@${version}` : framework.package;
  return {
    dependencies: missing(framework.dependencies),
    devDependencies: missing([renderer, ...framework.devDependencies]),
  };
}

/** Installs and registers the framework when needed, writes the droplet and its `./$types`. */
export async function addDroplet({ project, choices, steps }: AddDropletInput): Promise<AddResult> {
  const log = steps.log ?? (() => {});
  const runner = steps.runner ?? run;
  const { root, api } = project;
  const result: AddResult = { folder: "", written: [], installed: [], edited: [] };
  const { framework } = choices;

  if (!framework.builtIn && !api.renderers().includes(framework.name)) {
    const { dependencies, devDependencies } = missingPackages({ root, framework });
    for (const [specs, isDev] of [
      [dependencies, false],
      [devDependencies, true],
    ] as const) {
      if (specs.length === 0) continue;
      const command = installCommand({ pm: steps.pm, specs, isDev });
      log(`$ ${command.join(" ")}`);
      await runner({ argv: command, root });
      result.installed.push(...specs);
    }
    const configFile = project.configFile;
    const edit = configFile
      ? addRenderer({ source: await readFile(configFile, "utf8"), file: configFile, framework })
      : { manual: manualSteps({ framework }) };
    if ("code" in edit && configFile) {
      await writeFile(configFile, edit.code);
      result.edited.push(relative(root, configFile));
    } else if ("manual" in edit) {
      result.manual = edit.manual;
    }
    if (framework.jsxImportSource) {
      const tsconfig = join(root, "tsconfig.json");
      const code = await withJsx({ file: tsconfig, importSource: framework.jsxImportSource });
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

function oneOf<T extends string>({ value, allowed, flag }: OneOfInput<T>): T | undefined {
  if (value === undefined) return undefined;
  if ((allowed as readonly string[]).includes(value)) return value as T;
  throw dropletsError({ message: ADD_FLAG_VALUE_INVALID, params: { flag, value, allowed: allowed.join(", ") } });
}

/** Ends the command when a prompt was cancelled (ctrl-c, escape). */
function answer<T>({ value }: AnswerInput<T>): Exclude<T, symbol> {
  if (prompts.isCancel(value)) {
    prompts.cancel("Nothing written.");
    process.exit(1);
  }
  return value as Exclude<T, symbol>;
}

/** The command: the flags, then prompts for the rest when the terminal is interactive. */
export async function runAdd({ name, flags }: RunAddInput): Promise<void> {
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY) && !flags.yes;
  const project = await loadProject(flags);
  const configured = new Set(project.api.renderers());
  const pm = oneOf({ value: flags.pm, allowed: PACKAGE_MANAGERS, flag: "pm" }) ?? detectPackageManager({ root: project.root });
  const target = oneOf({ value: flags.target, allowed: TARGETS.map((t) => t.value), flag: "target" });
  const hydrate = oneOf({ value: flags.hydrate, allowed: HYDRATE_CHOICES, flag: "hydrate" });
  const frameworkChoices = ADD_KINDS.map((f) => f.name).join("|");
  const files = flags.with
    ?.split(",")
    .flatMap((file) => oneOf({ value: file.trim(), allowed: DROPLET_FILES.map((f) => f.value), flag: "with" }) ?? []);
  /** A formatted warning: confirmed when interactive, accepted with --yes, an error otherwise. */
  const accept = async ({ message, code }: { message: string; code: string }) => {
    prompts.log.warn(message);
    if (flags.yes) return;
    if (!interactive) throw dropletsError({ message: ADD_CONFIRMATION_NEEDED, params: { warning: code } });
    if (!answer({ value: await prompts.confirm({ message: "Go ahead?" }) })) {
      prompts.cancel("Nothing written.");
      process.exit(1);
    }
  };

  if (interactive) prompts.intro("djs add");

  if (name === undefined && !interactive) throw dropletsError({ message: ADD_NAME_MISSING });
  const dropletName =
    name ??
    answer({
      value: await prompts.text({
        message: "Droplet name",
        placeholder: "hello-world",
        validate: (value) => nameProblem({ name: value ?? "", project }),
      }),
    });
  const problem = nameProblem({ name: dropletName, project });
  if (problem) throw dropletsError({ message: ADD_NAME_INVALID, params: { name: dropletName, problem } });

  let framework: Framework | undefined;
  if (flags.framework) {
    framework = kindNamed({ name: flags.framework });
    if (!framework) {
      throw dropletsError({
        message: ADD_FLAG_VALUE_INVALID,
        params: { flag: "framework", value: flags.framework, allowed: ADD_KINDS.map((f) => f.name).join(", ") },
      });
    }
  } else if (!interactive) {
    if (configured.size !== 1) throw dropletsError({ message: ADD_FRAMEWORK_MISSING, params: { frameworks: frameworkChoices } });
    const [only] = configured;
    if (only !== undefined) framework = frameworkNamed({ name: only });
  } else {
    const ordered = [...FRAMEWORKS].sort((a, b) => Number(configured.has(b.name)) - Number(configured.has(a.name)));
    const picked = answer({
      value: await prompts.select({
        message: "Framework",
        options: [
          ...ordered.map((f) =>
            configured.has(f.name)
              ? { value: f.name, label: f.label }
              : { value: f.name, label: styleText("dim", f.label), hint: "not in vite.config: adds it" },
          ),
          { value: SCRIPT.name, label: SCRIPT.label, hint: "built in: runs in the browser with (data, el), renders nothing on the server" },
        ],
      }),
    });
    framework = kindNamed({ name: picked });
  }
  if (!framework) throw dropletsError({ message: ADD_FRAMEWORK_MISSING, params: { frameworks: frameworkChoices } });
  if (framework.builtIn) {
    // A script droplet: no target, no renderer to install, client only.
    if (target !== undefined) {
      throw dropletsError({
        message: ADD_OPTION_NOT_FOR_SCRIPT,
        params: { option: "--target", why: "it renders nothing on the server and always runs in the browser" },
      });
    }
    if (hydrate !== undefined) {
      throw dropletsError({
        message: ADD_OPTION_NOT_FOR_SCRIPT,
        params: { option: "--hydrate", why: "it is client only and runs at once" },
      });
    }
    const flags = scriptFlags();
    if (files?.includes("error")) {
      throw dropletsError({
        message: ADD_OPTION_NOT_FOR_SCRIPT,
        params: { option: "--with error", why: "it has no error page, it renders nothing" },
      });
    }
    const choices = dropletFileChoices({ framework });
    const chosenFiles =
      files ??
      (interactive
        ? answer({
            value: await prompts.multiselect({
              message: "Optional files",
              options: choices.map((f) => ({ value: f.value, label: f.label, hint: f.hint })),
              required: false,
            }),
          })
        : []);
    const result = await addDroplet({
      project,
      choices: { name: dropletName, framework, flags, files: new Set(chosenFiles) },
      steps: { pm, log: (message) => prompts.log.step(message) },
    });
    return report({ result, dropletName, interactive });
  }
  if (!configured.has(framework.name)) {
    const { dependencies, devDependencies } = missingPackages({ root: project.root, framework });
    const specs = [...dependencies, ...devDependencies].map((spec) => packageName({ spec }));
    const install = specs.length > 0 ? `install ${specs.join(", ")} and ` : "";
    await accept({
      message: formatMessage({
        message: ADD_RENDERER_INSTALL,
        params: { change: `${install}add ${framework.factory}() to renderers in vite.config` },
      }),
      code: ADD_RENDERER_INSTALL.code,
    });
  }

  const chosenTarget =
    target ??
    (interactive
      ? answer({
          value: await prompts.select({ message: "Target", options: TARGETS.map((t) => ({ ...t })), initialValue: "full" as Target }),
        })
      : "full");
  let chosenHydrate: HydrateChoice | undefined = hydrate;
  if (chosenHydrate === undefined && chosenTarget === "full" && interactive) {
    chosenHydrate = answer({
      value: await prompts.select({
        message: "Hydrate",
        options: FULL_HYDRATE.map((h) => ({ ...h })),
        initialValue: "always" as HydrateChoice,
      }),
    });
  }
  const { flags: dropletFlags, notes } = flagsFor({ target: chosenTarget, hydrate: chosenHydrate });
  for (const note of notes) if (note.level === "info") prompts.log.info(note.message);
  for (const note of notes) if (note.level === "warn") await accept(note);

  const chosenFiles =
    files ??
    (interactive
      ? answer({
          value: await prompts.multiselect({
            message: "Optional files",
            options: DROPLET_FILES.map((f) => ({ value: f.value, label: f.label, hint: f.hint })),
            required: false,
          }),
        })
      : []);

  const result = await addDroplet({
    project,
    choices: { name: dropletName, framework, flags: dropletFlags, files: new Set(chosenFiles) },
    steps: { pm, log: (message) => prompts.log.step(message) },
  });
  report({ result, dropletName, interactive });
}

/** What was written and changed, and where to see the droplet. */
function report({ result, dropletName, interactive }: ReportInput): void {
  for (const file of result.edited) prompts.log.success(`updated ${file}`);
  for (const file of result.written) prompts.log.success(`created ${file}`);
  if (result.manual) {
    prompts.log.warn(formatMessage({ message: ADD_VITE_CONFIG_NOT_UPDATED, params: { manual: result.manual } }));
  }
  const next = `${result.folder}/ is ready: vite dev, then /?droplet=${dropletName} or /droplets/${dropletName}`;
  if (interactive) prompts.outro(next);
  else prompts.log.info(next);
}
