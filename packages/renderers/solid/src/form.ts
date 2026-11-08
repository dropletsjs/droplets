/**
 * `enhanceDropletForm`: a Solid directive, progressive enhancement for one
 * form of a Solid droplet, opt-in. `use:enhanceDropletForm` applies
 * `enhanceDropletForm` of `$droplets/form` to the form and stops when it
 * goes; its value (options, or nothing) is read at each submit.
 *
 * ```tsx
 * import { actionUrl } from "$droplets/form";
 * import { enhanceDropletForm } from "@dropletsjs/renderer-solid/form";
 * import type { DropletActions } from "./$types";
 * void enhanceDropletForm; // `use:` needs it in scope
 *
 * export default function Cart() {
 *   const add = actionUrl<DropletActions>("add");
 *   return <form method="post" action={add} use:enhanceDropletForm={{ action: "add" }}>…</form>;
 * }
 * ```
 *
 * Without it the form posts as any form does; on the server Solid does
 * not run directives.
 */
import {
  enhanceDropletForm as enhance,
  type AnyEnhanceOptions,
  type EnhanceOptions,
} from "@dropletsjs/droplets/enhance";
import { onCleanup, type Accessor } from "solid-js";

export function enhanceDropletForm(form: HTMLFormElement, value?: Accessor<EnhanceOptions | true | undefined>): void {
  const current = (): EnhanceOptions | undefined => {
    const options = value?.();
    return options === true ? undefined : options;
  };
  onCleanup(
    enhance(form, {
      get action() {
        return current()?.action;
      },
      onSubmit: (submit) => current()?.onSubmit?.(submit),
      onResult: (result) => {
        const onResult = current()?.onResult;
        return onResult ? onResult(result) : result.update();
      },
    } as EnhanceOptions as AnyEnhanceOptions),
  );
}

declare module "solid-js" {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface Directives {
      /** `use:enhanceDropletForm` or `use:enhanceDropletForm={{ action, onSubmit, onResult }}`. */
      enhanceDropletForm: EnhanceOptions | true;
    }
  }
}
