import type { ActionEnhanceOptions, ActionMap, AnyEnhanceOptions } from "@dropletsjs/droplets/enhance";
import type { ActionReturn } from "svelte/action";

/**
 * `use:enhanceDropletForm` (or `use:enhanceDropletForm={options}`):
 * `enhanceDropletForm` of `$droplets/form` applied to the form, its
 * options following the action's `update`. Typed by `DropletActions` of
 * `./$types` through an instantiation: `enhanceDropletForm<DropletActions>`.
 */
export function enhanceDropletForm<A extends ActionMap = ActionMap>(
  form: HTMLFormElement,
  options?: AnyEnhanceOptions<A> | ActionEnhanceOptions<A>,
): ActionReturn<AnyEnhanceOptions<A> | ActionEnhanceOptions<A> | undefined>;
