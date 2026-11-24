/**
 * The messages of the `djs` command: `djs sync` and `djs add`.
 *
 * @module
 */
import type { AnyMessage, ErrorPages } from "./format.ts";

export const DJS_COMMAND_UNKNOWN = {
  code: "djs-command-unknown",
  level: "error",
  what: ({ command }: { command: string }) => `unknown command "${command}"`,
  fix: "run djs sync or djs add <name>; djs --help lists the options",
} satisfies AnyMessage;

export const DJS_COMMAND_FAILED = {
  code: "djs-command-failed",
  level: "error",
  what: ({ reason }: { reason: string }) => reason,
  fix: "fix what the message names and run the command again",
} satisfies AnyMessage;

export const ADD_FLAG_VALUE_INVALID = {
  code: "add-flag-value-invalid",
  level: "error",
  what: ({ flag, value }: { flag: string; value: string; allowed: string }) => `--${flag} ${value} is not one of its values`,
  fix: ({ allowed }: { flag: string; value: string; allowed: string }) => `expected ${allowed}`,
} satisfies AnyMessage;

export const ADD_NAME_MISSING = {
  code: "add-name-missing",
  level: "error",
  what: "no droplet name was given",
  fix: "name the droplet: djs add <name> (or run djs add in a terminal to be asked)",
} satisfies AnyMessage;

export const ADD_NAME_INVALID = {
  code: "add-name-invalid",
  level: "error",
  what: ({ name, problem }: { name: string; problem: string }) => `the name "${name}" cannot be used: ${problem}`,
  fix: "pick a lowercase kebab-case name, starting with a letter, that no droplet or folder has yet",
} satisfies AnyMessage;

export const ADD_FRAMEWORK_MISSING = {
  code: "add-framework-missing",
  level: "error",
  what: "no framework was given, and vite.config does not have exactly one renderer to default to",
  fix: ({ frameworks }: { frameworks: string }) => `pick a framework: --framework ${frameworks} (or run djs add in a terminal to be asked)`,
} satisfies AnyMessage;

export const ADD_OPTION_NOT_FOR_SCRIPT = {
  code: "add-option-not-for-script",
  level: "error",
  what: ({ option, why }: { option: string; why: string }) => `${option} does not apply to a script droplet: ${why}`,
  fix: ({ option }: { option: string; why: string }) => `leave out ${option}`,
} satisfies AnyMessage;

export const ADD_FULL_WITHOUT_HYDRATION = {
  code: "add-full-without-hydration",
  level: "error",
  what: "--target full always hydrates",
  fix: "for HTML without JavaScript use --target ssr",
} satisfies AnyMessage;

export const ADD_RENDERER_INSTALL = {
  code: "add-renderer-install",
  level: "warning",
  what: ({ change }: { change: string }) => `this will ${change}`,
  fix: "confirm to go ahead, or pick a framework vite.config already has",
} satisfies AnyMessage;

export const ADD_BLANK_COMPONENT = {
  code: "add-blank-component",
  level: "warning",
  what: "this will result in a blank component: nothing is rendered on the server, nothing is rendered in the browser",
  fix: "pick another --target or --hydrate, or confirm to write it anyway",
} satisfies AnyMessage;

export const ADD_CLIENT_ONLY_INTERACTIVE = {
  code: "add-client-only-interactive",
  level: "warning",
  what: "a client-only droplet has no server markup to interact with: it mounts at once, as with --hydrate always",
  fix: "use --target full --hydrate interactive to wait for an interaction, or confirm to mount it at once",
} satisfies AnyMessage;

export const ADD_CONFIRMATION_NEEDED = {
  code: "add-confirmation-needed",
  level: "error",
  what: ({ warning }: { warning: string }) => `the warning ${warning} above needs a confirmation`,
  fix: "pass --yes to go ahead (or run djs add in a terminal to be asked)",
} satisfies AnyMessage;

export const ADD_VITE_CONFIG_NOT_UPDATED = {
  code: "add-vite-config-not-updated",
  level: "warning",
  what: "vite.config could not be updated",
  fix: ({ manual }: { manual: string }) => `add the renderer by hand, then run djs sync:\n${manual}`,
} satisfies AnyMessage;

export const ADD_NO_DROPLETS_PLUGIN = {
  code: "add-no-droplets-plugin",
  level: "error",
  what: "no droplets() plugin in the Vite config",
  fix: "add droplets() to plugins in vite.config, or pass --root or --config to point at the project",
} satisfies AnyMessage;

export const ADD_JSX_IMPORT_SOURCE_MISSING = {
  code: "add-jsx-import-source-missing",
  level: "error",
  what: ({ framework }: { framework: string }) => `${framework} has no jsxImportSource`,
  fix: "report it: the framework's entry in djs add's catalog is incomplete",
} satisfies AnyMessage;

export const ADD_INSTALL_FAILED = {
  code: "add-install-failed",
  level: "error",
  what: ({ command, code }: { command: string; code: string }) => `${command} exited with ${code}`,
  fix: "read the package manager's output above, fix the cause, then run djs add again",
} satisfies AnyMessage;

export const CLI_PAGES: ErrorPages = {
  "djs-command-unknown": {
    when: "djs is run with a command other than sync or add.",
    see: "/reference/api/#djs",
  },
  "djs-command-failed": {
    when: "A djs command stops on an error that carries no code of its own, such as an unknown option or a Vite config that fails to load.",
    see: "/reference/api/#djs",
  },
  "add-flag-value-invalid": {
    when: "djs add is given --framework, --target, --hydrate, --with or --pm with a value it does not know.",
    see: "/reference/api/#djs-add",
  },
  "add-name-missing": {
    when: "djs add runs outside an interactive terminal (or with --yes) without a droplet name.",
    see: "/reference/api/#djs-add",
  },
  "add-name-invalid": {
    when: "djs add is given a name that is not lowercase kebab-case, or that a droplet or a folder already has.",
    see: "/reference/api/#djs-add",
  },
  "add-framework-missing": {
    when: "djs add runs outside an interactive terminal without --framework, and vite.config does not have exactly one renderer.",
    see: "/reference/api/#djs-add",
  },
  "add-option-not-for-script": {
    when: "djs add --framework script is given --target, --hydrate or --with error, which a script droplet does not have.",
    see: "/guides/writing-droplets/#script-droplets",
  },
  "add-full-without-hydration": {
    when: "djs add is given --target full with --hydrate none.",
    see: "/reference/api/#djs-add",
  },
  "add-renderer-install": {
    when: "djs add is asked for a droplet in a framework vite.config has no renderer for; it installs the packages and adds the renderer once confirmed.",
    see: "/reference/api/#djs-add",
  },
  "add-blank-component": {
    when: "djs add is given --target client with --hydrate none, a droplet that renders nothing anywhere.",
    see: "/reference/api/#djs-add",
  },
  "add-client-only-interactive": {
    when: "djs add is given --target client with --hydrate interactive; a client-only droplet has no markup to interact with.",
    see: "/reference/api/#djs-add",
  },
  "add-confirmation-needed": {
    when: "djs add meets one of its warnings (a renderer to install, a blank or client-only droplet) outside an interactive terminal and without --yes.",
    see: "/reference/api/#djs-add",
  },
  "add-vite-config-not-updated": {
    when: "djs add cannot find where to add the renderer in vite.config and prints the lines to add by hand.",
    see: "/reference/api/#djs-add",
  },
  "add-no-droplets-plugin": {
    when: "djs add or djs sync loads the Vite config and finds no droplets() plugin in it.",
    see: "/reference/api/#djs",
  },
  "add-jsx-import-source-missing": {
    when: "djs add writes a JSX component for a framework whose catalog entry names no JSX import source: a bug in djs add.",
  },
  "add-install-failed": {
    when: "djs add runs the package manager to install a renderer and it exits with an error.",
    see: "/reference/api/#djs-add",
  },
};
