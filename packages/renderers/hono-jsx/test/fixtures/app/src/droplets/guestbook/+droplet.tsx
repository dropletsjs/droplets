import { useRef, useState } from "hono/jsx";
import { actionUrl } from "$droplets/form";
import type { DropletProps } from "@dropletsjs/renderer-hono-jsx";
import { useEnhanceDropletForm } from "@dropletsjs/renderer-hono-jsx/form";

export const prerender = true;

// What the last action returned, or its fail() data. `sign` and `leave`
// are enhanced; `plain` posts as any form does.
export default function Guestbook({ form }: DropletProps<{ count: number }, { message: string }>) {
  const [urls] = useState(() => ({ sign: actionUrl(), leave: actionUrl("leave"), echo: actionUrl("echo") }));
  const sign = useRef<HTMLFormElement>(null);
  const leave = useRef<HTMLFormElement>(null);
  useEnhanceDropletForm(sign);
  useEnhanceDropletForm(leave, { action: "leave" });
  return (
    <>
      <form method="post" action={urls.sign} data-testid="sign" ref={sign}>
        <input name="name" />
        <p data-testid="form">{form?.message ?? "none"}</p>
      </form>
      <form method="post" action={urls.leave} data-testid="leave" ref={leave}></form>
      <form method="post" action={urls.echo} data-testid="plain"></form>
    </>
  );
}
