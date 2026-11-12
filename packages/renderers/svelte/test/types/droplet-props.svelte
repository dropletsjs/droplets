<!--
  svelte-check reads this (`pnpm typecheck`): `data` of `DropletProps` is the
  value, so a component reads it directly, as the README does, and `await`
  still type-checks for async mode.
-->
<script lang="ts">
  import type { DropletErrorProps, DropletProps } from "../../src/index.ts";

  let { data, form, children }: DropletProps<{ greeting: string }, { ok: boolean }> = $props();
  const direct = $derived<string>(data.greeting);
  const error: DropletErrorProps<{ message: string }>["error"] = { message: "" };
</script>

<h1>{data.greeting}{direct}</h1>
<p>{(await data).greeting}</p>
{#await data then { greeting }}<p>{greeting}</p>{/await}
{#if form?.ok}<p>{error.message}</p>{/if}
{@render children?.()}
