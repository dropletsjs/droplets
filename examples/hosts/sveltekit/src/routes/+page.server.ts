import { DROPLETS_PUBLIC_URL, fragment } from "$lib/droplets.server.ts";
import type { PageServerLoad } from "./$types";

// The Svelte example's droplets (examples/frameworks/svelte), one per mode.
const IDS = ["client", "ssr-hydrate", "ssr-nohydrate"];

export const load: PageServerLoad = async ({ fetch, url }) => {
  const who = url.searchParams.get("who") ?? "SvelteKit";
  const fragments = await Promise.all(
    IDS.map((id) => fragment(fetch, id, { who })),
  );
  return { dropletsUrl: DROPLETS_PUBLIC_URL, fragments };
};
