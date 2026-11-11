/**
 * `@dropletsjs/renderer-vue/form`: `useEnhanceDropletForm(formRef,
 * options?)`, progressive enhancement for one form of a Vue droplet,
 * opt-in. A composable: it applies `enhanceDropletForm` of `$droplets/form`
 * to the form the ref holds, follows the ref (a form under `v-if` comes
 * and goes) and stops with the component. Options are read at each submit.
 *
 * ```vue
 * <script setup lang="ts">
 * import { ref } from "vue";
 * import { actionUrl } from "$droplets/form";
 * import { useEnhanceDropletForm } from "@dropletsjs/renderer-vue/form";
 * import type { DropletActions } from "./$types";
 *
 * const add = actionUrl<DropletActions>("add");
 * const form = ref<HTMLFormElement | null>(null);
 * useEnhanceDropletForm<DropletActions>(form, { action: "add" });
 * </script>
 *
 * <template>
 *   <form ref="form" method="post" :action="add">…</form>
 * </template>
 * ```
 *
 * Without it the form posts as any form does; on the server it does
 * nothing. This entry is browser-safe: it only imports `vue` and core's
 * `enhance` module.
 */
import {
  enhanceDropletForm,
  type ActionEnhanceOptions,
  type ActionMap,
  type AnyEnhanceOptions,
  type EnhanceOptions,
} from "@dropletsjs/droplets/enhance";
import { toValue, watch, type MaybeRefOrGetter } from "vue";

export function useEnhanceDropletForm<A extends ActionMap = ActionMap>(
  formRef: MaybeRefOrGetter<HTMLFormElement | null | undefined>,
  options?: MaybeRefOrGetter<AnyEnhanceOptions<A> | undefined>,
): void;
export function useEnhanceDropletForm<A extends ActionMap = ActionMap>(
  formRef: MaybeRefOrGetter<HTMLFormElement | null | undefined>,
  options: MaybeRefOrGetter<ActionEnhanceOptions<A>>,
): void;
export function useEnhanceDropletForm(
  formRef: MaybeRefOrGetter<HTMLFormElement | null | undefined>,
  options?: MaybeRefOrGetter<EnhanceOptions | undefined>,
): void {
  const current = () => toValue(options);
  watch(
    () => toValue(formRef),
    (form, _previous, onCleanup) => {
      if (!form) return;
      onCleanup(
        enhanceDropletForm(form, {
          get action() {
            return current()?.action;
          },
          onSubmit: (submit) => current()?.onSubmit?.(submit),
          onResult: (result) => {
            const onResult = current()?.onResult;
            return onResult ? onResult(result) : result.update();
          },
        }),
      );
    },
    { immediate: true, flush: "post" },
  );
}
