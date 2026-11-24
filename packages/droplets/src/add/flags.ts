/**
 * `djs add`'s target and hydrate choices, and the flags they make. `full`
 * asks when to hydrate; the other targets imply it, and `--hydrate` changes
 * it, with a warning where the result is not what the target suggests.
 */
import { ADD_BLANK_COMPONENT, ADD_CLIENT_ONLY_INTERACTIVE, ADD_FULL_WITHOUT_HYDRATION } from "../errors/cli.ts";
import { dropletsError, formatMessage } from "../errors/format.ts";
import type { HydrateMode } from "../renderer.ts";

export type Target = "full" | "ssr" | "client" | "ssg";
export type HydrateChoice = "always" | "visible" | "interactive" | "none";

export const TARGETS: readonly { value: Target; label: string; hint: string }[] = [
  { value: "full", label: "full", hint: "rendered on the server, then interactive in the browser" },
  { value: "ssr", label: "ssr", hint: "rendered on the server only: HTML and CSS, no JavaScript" },
  { value: "client", label: "client", hint: "rendered in the browser only" },
  { value: "ssg", label: "ssg", hint: "rendered at build time, then interactive in the browser" },
];

/** What `full` offers: it always hydrates, the question is when. */
export const FULL_HYDRATE: readonly { value: HydrateChoice; label: string; hint: string }[] = [
  { value: "always", label: "always", hint: "as soon as the page loads" },
  { value: "visible", label: "visible", hint: "when it is about to scroll into view" },
  { value: "interactive", label: "interactive", hint: "on the first click, key or focus on it" },
];

export const HYDRATE_CHOICES: readonly HydrateChoice[] = ["always", "visible", "interactive", "none"];

export type Flags = { ssr: boolean; hydrate: HydrateMode; prerender: boolean };

/** `warn` needs a confirmation (or `--yes`), its message a formatted warning; `info` is only printed. */
export type Note = { level: "info"; message: string } | { level: "warn"; message: string; code: string };

const MODES: Record<HydrateChoice, HydrateMode> = {
  always: true,
  visible: "visible",
  interactive: "interactive",
  none: false,
};

const DEFAULT_HYDRATE: Record<Target, HydrateChoice> = {
  full: "always",
  ssr: "none",
  client: "always",
  ssg: "always",
};

export type TargetFlags = { flags: Flags; notes: Note[] };

/** The flags of a script droplet: client only, nothing to choose. */
export function scriptFlags(): Flags {
  return { ssr: false, hydrate: true, prerender: false };
}

export type FlagsForInput = { target: Target; hydrate?: HydrateChoice | undefined };

/** The flags for a target, and what to tell the user about the combination. Throws for `full` without hydration. */
export function flagsFor({ target, hydrate }: FlagsForInput): TargetFlags {
  const choice = hydrate ?? DEFAULT_HYDRATE[target];
  const notes: Note[] = [];
  if (target === "full" && choice === "none") {
    throw dropletsError({ message: ADD_FULL_WITHOUT_HYDRATION });
  }
  if (target === "ssr" && choice !== "none") {
    notes.push({ level: "info", message: `ssr with --hydrate ${choice} is the same as --target full --hydrate ${choice}` });
  }
  if (target === "client" && choice === "none") {
    notes.push({ level: "warn", message: formatMessage({ message: ADD_BLANK_COMPONENT }), code: ADD_BLANK_COMPONENT.code });
  }
  if (target === "client" && choice === "interactive") {
    notes.push({ level: "warn", message: formatMessage({ message: ADD_CLIENT_ONLY_INTERACTIVE }), code: ADD_CLIENT_ONLY_INTERACTIVE.code });
  }
  return {
    flags: { ssr: target !== "client", hydrate: MODES[choice], prerender: target === "ssg" },
    notes,
  };
}
