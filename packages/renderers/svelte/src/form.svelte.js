/**
 * `@dropletsjs/renderer-svelte/form`: `enhanceDropletForm`, a
 * Svelte action, progressive enhancement for one form of a Svelte droplet,
 * opt-in. `use:enhanceDropletForm` applies `enhanceDropletForm` of
 * `$droplets/form` to the form and stops when it goes; its options follow
 * the action's `update`.
 *
 * ```svelte
 * <script lang="ts">
 *   import { actionUrl } from "$droplets/form";
 *   import { enhanceDropletForm } from "@dropletsjs/renderer-svelte/form";
 *   import type { DropletActions } from "./$types";
 *   const add = actionUrl<DropletActions>("add");
 * </script>
 *
 * <form method="post" action={add} use:enhanceDropletForm={{ action: "add" }}>…</form>
 * ```
 *
 * Without it the form posts as any form does; on the server Svelte does
 * not run actions. Shipped as source like the renderer's `.svelte` files.
 */
import { enhanceDropletForm as enhance } from "@dropletsjs/droplets/enhance";

/**
 * @param {HTMLFormElement} form
 * @param {import("@dropletsjs/droplets/enhance").EnhanceOptions} [options]
 */
export function enhanceDropletForm(form, options) {
  let current = options;
  const stop = enhance(form, {
    get action() {
      return current?.action;
    },
    onSubmit: (submit) => current?.onSubmit?.(submit),
    onResult: (result) => (current?.onResult ? current.onResult(result) : result.update()),
  });
  return {
    /** @param {import("@dropletsjs/droplets/enhance").EnhanceOptions} [next] */
    update(next) {
      current = next;
    },
    destroy: stop,
  };
}
