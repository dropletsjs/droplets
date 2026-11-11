<!--
  What a droplet mounted with `data` still to come renders under: its
  component inside `<svelte:boundary>`. What throws while rendering, a
  rejected `await data` included, goes through `handle` (the droplet's
  `handleError`) into the error page, rendered in its place; nothing while
  `handle` runs, or when it rejects.

  The boundary removes the failed content without out transitions, so the
  marker's `release` would not run: a rejected `data` takes the container
  out first (this handler runs before the component's `await` sees the
  rejection), and puts it back if the component handled it and kept its
  marker.
-->
<script lang="ts">
  import { getContext, untrack, type Component, type Snippet } from "svelte";
  import type { DropletChildrenHost } from "@dropletsjs/droplets";
  import { CHILDREN_KEY, releaseHost } from "./children.js";

  let {
    component: Droplet,
    props,
    errorComponent: ErrorComponent,
    handle,
    children,
  }: {
    component: Component<Record<string, unknown>>;
    props: Record<string, unknown>;
    errorComponent: Component<Record<string, unknown>>;
    handle: (error: unknown) => Promise<unknown>;
    children: Snippet;
  } = $props();

  const host = getContext<DropletChildrenHost | undefined>(CHILDREN_KEY);
  // The props of a mount: read once, before the component reads them.
  Promise.resolve(untrack(() => props["data"])).catch(() => {
    const restore = releaseHost(host);
    setTimeout(restore);
  });
</script>

<svelte:boundary>
  <Droplet {...props} />
  {#snippet failed(error)}
    {#await handle(error) then shown}<ErrorComponent error={shown} {children} />{:catch}{/await}
  {/snippet}
</svelte:boundary>
