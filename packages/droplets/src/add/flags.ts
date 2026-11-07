/**
 * `djs add`'s target and hydrate choices, and the flags they make. `full`
 * asks when to hydrate; the other targets imply it, and `--hydrate` changes
 * it, with a warning where the result is not what the target suggests.
 */
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

/** `warn` needs a confirmation (or `--yes`); `info` is only printed. */
export type Note = { level: "warn" | "info"; message: string };

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

/** When a script droplet runs: it always does, at once or as it scrolls into view. */
export const SCRIPT_HYDRATE: readonly { value: HydrateChoice; label: string; hint: string }[] = [
  { value: "always", label: "always", hint: "as soon as the page loads" },
  { value: "visible", label: "visible", hint: "when it is about to scroll into view" },
];

/**
 * The flags of a script droplet: no target to choose (nothing renders on
 * the server, it always runs in the browser), and only `always` or
 * `visible`. Throws for anything else.
 */
export function scriptFlags(hydrate: HydrateChoice = "always"): Flags {
  if (hydrate !== "always" && hydrate !== "visible") {
    throw new Error(`--hydrate ${hydrate}: a script droplet always runs in the browser; use always or visible`);
  }
  return { ssr: true, hydrate: MODES[hydrate], prerender: false };
}

/** The flags for a target, and what to tell the user about the combination. Throws for `full` without hydration. */
export function flagsFor(target: Target, hydrate?: HydrateChoice): { flags: Flags; notes: Note[] } {
  const choice = hydrate ?? DEFAULT_HYDRATE[target];
  const notes: Note[] = [];
  if (target === "full" && choice === "none") {
    throw new Error('--target full always hydrates; for HTML without JavaScript use --target ssr');
  }
  if (target === "ssr" && choice !== "none") {
    notes.push({ level: "info", message: `ssr with --hydrate ${choice} is the same as --target full --hydrate ${choice}` });
  }
  if (target === "client" && choice === "none") {
    notes.push({
      level: "warn",
      message: "this will result in a blank component: nothing is rendered on the server, nothing is rendered in the browser",
    });
  }
  if (target === "client" && choice === "interactive") {
    notes.push({
      level: "warn",
      message: "a client-only droplet has no server markup to interact with: it mounts at once, as with --hydrate always",
    });
  }
  return {
    flags: { ssr: target !== "client", hydrate: MODES[choice], prerender: target === "ssg" },
    notes,
  };
}
