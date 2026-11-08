<script module lang="ts">
  export const prerender = true;
</script>

<script lang="ts">
  import { actionUrl } from "$droplets/form";
  import type { DropletProps } from "@dropletsjs/renderer-svelte";
  import { enhanceDropletForm } from "@dropletsjs/renderer-svelte/form";

  // What the last action returned, or its fail() data. `sign` and `leave`
  // are enhanced; `plain` posts as any form does.
  let { form }: DropletProps<{ count: number }, { message: string }> = $props();
  const sign = actionUrl();
  const leave = actionUrl("leave");
  const echo = actionUrl("echo");
</script>

<form method="post" action={sign} data-testid="sign" use:enhanceDropletForm><input name="name" /><p data-testid="form">{form?.message ?? "none"}</p></form>
<form method="post" action={leave} data-testid="leave" use:enhanceDropletForm={{ action: "leave" }}></form>
<form method="post" action={echo} data-testid="plain"></form>
