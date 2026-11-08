import { actionUrl } from "$droplets/form";
import type { DropletProps } from "@dropletsjs/renderer-solid";
import { enhanceDropletForm } from "@dropletsjs/renderer-solid/form";

export const prerender = true;

// `use:` needs the directive in scope, not only in a type.
void enhanceDropletForm;

// What the last action returned, or its fail() data. `sign` and `leave`
// are enhanced; `plain` posts as any form does.
export default function Guestbook(props: DropletProps<{ count: number }, { message: string }>) {
  const sign = actionUrl();
  const leave = actionUrl("leave");
  const echo = actionUrl("echo");
  return (
    <>
      <form method="post" action={sign} data-testid="sign" use:enhanceDropletForm>
        <input name="name" />
        <p data-testid="form">{props.form?.message ?? "none"}</p>
      </form>
      <form method="post" action={leave} data-testid="leave" use:enhanceDropletForm={{ action: "leave" }}></form>
      <form method="post" action={echo} data-testid="plain"></form>
    </>
  );
}
