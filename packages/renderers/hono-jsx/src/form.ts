/**
 * `useEnhanceDropletForm(formRef, options?)`: progressive enhancement for
 * one form of a Hono JSX droplet, opt-in. It applies `enhanceDropletForm` of
 * `$droplets/form` to the form once it is mounted, and removes it when the
 * form goes; options are read at each submit, so they may change between
 * renders.
 *
 * ```tsx
 * import { useRef, useState } from "hono/jsx";
 * import { actionUrl } from "$droplets/form";
 * import { useEnhanceDropletForm } from "@dropletsjs/renderer-hono-jsx/form";
 * import type { DropletActions, DropletProps } from "./$types";
 *
 * export default function Cart({ form }: DropletProps) {
 *   const [add] = useState(() => actionUrl<DropletActions>("add"));
 *   const ref = useRef<HTMLFormElement>(null);
 *   useEnhanceDropletForm<DropletActions>(ref, { action: "add" });
 *   return <form method="post" action={add} ref={ref}>…</form>;
 * }
 * ```
 *
 * Without it the form posts as any form does; on the server it does
 * nothing. Imports `hono/jsx`, which the renderer's plugin resolves to
 * `hono/jsx/dom` in the browser: the hooks are the engine's on each side.
 */
import { useEffect, useRef, type RefObject } from "hono/jsx";
import {
  enhanceDropletForm,
  type ActionEnhanceOptions,
  type ActionMap,
  type AnyEnhanceOptions,
  type EnhanceOptions,
} from "@dropletsjs/droplets/enhance";

export function useEnhanceDropletForm<A extends ActionMap = ActionMap>(
  formRef: RefObject<HTMLFormElement | null>,
  options?: AnyEnhanceOptions<A>,
): void;
export function useEnhanceDropletForm<A extends ActionMap = ActionMap>(
  formRef: RefObject<HTMLFormElement | null>,
  options: ActionEnhanceOptions<A>,
): void;
export function useEnhanceDropletForm(formRef: RefObject<HTMLFormElement | null>, options?: EnhanceOptions): void {
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    return enhanceDropletForm(form, {
      get action() {
        return latest.current?.action;
      },
      onSubmit: (submit) => latest.current?.onSubmit?.(submit),
      onResult: (result) => (latest.current?.onResult ? latest.current.onResult(result) : result.update()),
    });
  }, [formRef]);
}
