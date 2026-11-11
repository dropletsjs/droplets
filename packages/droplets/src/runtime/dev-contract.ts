/**
 * Dev only: what a page does when a droplet's render contract changes under
 * `dev.strategy: "hmr"`. The contract is the droplet's `ssr`, `hydrate` and
 * `prerender` flags; the plugin reads them from source on every edit and
 * sends the old and the new ones. Plain functions over plain data: the
 * element applies them, the tests check the table.
 *
 * The page's droplet is never changed to follow a new contract, but for one
 * case: `hydrate` turning on hydrates the server markup there, live.
 *
 * | Change | The page |
 * | --- | --- |
 * | `ssr` false → true | notification, with "Reload page" |
 * | `ssr` true → false | notification |
 * | `hydrate` false → on (`true`, `"visible"`, `"interactive"`) | hydrates the markup there, in the new mode |
 * | `hydrate` on → false | notification, with "Reload page"; the running component stays |
 * | `hydrate` between `true`, `"visible"`, `"interactive"` | not hydrated yet: waits in the new mode; hydrated: a console note |
 * | `prerender`, either way | notification (prerendering happens in `vite build`) |
 */
import type { HydrateMode } from "../renderer.ts";

/** A droplet's render contract, as the plugin reads it from source. */
export type RenderContract = { ssr: boolean; hydrate: HydrateMode; prerender: boolean };

export type ContractFlag = keyof RenderContract;

export type ContractChange = { flag: ContractFlag; from: RenderContract[ContractFlag]; to: RenderContract[ContractFlag] };

/** What the page shows for a droplet's new contract: once per droplet, however many elements show it. */
export type ContractNotice = {
  /** `counter changed its render contract: hydrate true → false`. */
  message: string;
  /** What happens next, or what to do. */
  detail: string;
  /** Offer "Reload page": the change shows only in a page rendered afresh. */
  reload: boolean;
  /**
   * `false` when a console line says it all: `hydrate` moved between its
   * modes, which a hydrated element ignores and a waiting one follows.
   */
  toast: boolean;
};

const FLAGS: readonly ContractFlag[] = ["ssr", "hydrate", "prerender"];

export function isHydrateMode(value: unknown): value is HydrateMode {
  return value === true || value === false || value === "visible" || value === "interactive";
}

type ReadContractInput = { value: unknown };

/** A contract from the socket, checked: plain data with known flags only, else `null`. */
export function readContract({ value }: ReadContractInput): RenderContract | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!FLAGS.every((flag) => Object.hasOwn(record, flag))) return null;
  const { ssr, hydrate, prerender } = record;
  if (typeof ssr !== "boolean" || typeof prerender !== "boolean" || !isHydrateMode(hydrate)) return null;
  return { ssr, hydrate, prerender };
}

type ContractChangesInput = { before: RenderContract; after: RenderContract };

/** The flags that differ, in the order `ssr`, `hydrate`, `prerender`. */
export function contractChanges({ before, after }: ContractChangesInput): ContractChange[] {
  return FLAGS.filter((flag) => before[flag] !== after[flag]).map((flag) => ({ flag, from: before[flag], to: after[flag] }));
}

type FormatChangesInput = { changes: readonly ContractChange[] };

/** `ssr false → true, hydrate true → false`. */
export function formatChanges({ changes }: FormatChangesInput): string {
  return changes.map((change) => `${change.flag} ${String(change.from)} → ${String(change.to)}`).join(", ");
}

type ContractNoticeInput = { droplet: string; before: RenderContract; after: RenderContract };

/** What the page says about `droplet`'s new contract; `null` when nothing changed. */
export function contractNotice({ droplet, before, after }: ContractNoticeInput): ContractNotice | null {
  const changes = contractChanges({ before, after });
  if (changes.length === 0) return null;
  const details: string[] = [];
  let reload = false;
  let toast = false;
  for (const change of changes) {
    if (change.flag === "ssr") {
      toast = true;
      if (change.to === true) {
        reload = true;
        details.push("The server renders it from now on; reload the page to see its markup.");
      } else {
        details.push("The page keeps the markup it has; a new render has none.");
      }
    } else if (change.flag === "hydrate") {
      if (change.from === false) {
        toast = true;
        details.push(
          change.to === true
            ? "Hydrated in place."
            : `Hydrates in place, ${change.to === "visible" ? "once visible" : "on the first interaction"}.`,
        );
      } else if (change.to === false) {
        toast = true;
        reload = true;
        details.push("The running component stays as it is; reload the page to see it without JavaScript.");
      } else {
        details.push("A droplet not hydrated yet waits in the new mode; a hydrated one stays as it is.");
      }
    } else {
      toast = true;
      details.push("Prerendering happens in vite build: check it with vite preview.");
    }
  }
  return {
    message: `${droplet} changed its render contract: ${formatChanges({ changes })}`,
    detail: details.join(" "),
    reload,
    toast,
  };
}

/** Where one element is: hydrated (or mounted), waiting for `"visible"` or `"interactive"`, or neither. */
export type ElementLife = "live" | "waiting" | "static";

/**
 * What one element does about its new `hydrate` mode (the host's
 * `data-hydrate` already applied to both): `hydrate` the markup there in the
 * new mode, `rewait` in the new mode, a console `note`, or nothing (`keep`
 * the running component, or `none` when the mode is the same).
 */
export type HydrateAction = "hydrate" | "rewait" | "note" | "keep" | "none";

type HydrateActionInput = { before: HydrateMode; after: HydrateMode; life: ElementLife };

export function hydrateAction({ before, after, life }: HydrateActionInput): HydrateAction {
  if (before === after) return "none";
  if (after === false) return "keep";
  if (before === false || life === "static") return life === "live" ? "note" : "hydrate";
  return life === "waiting" ? "rewait" : "note";
}
