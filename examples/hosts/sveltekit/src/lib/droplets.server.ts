import { env } from "$env/dynamic/private";

/** Server-to-server address (inside Docker: the service name). */
export const DROPLETS_INTERNAL_URL = env.DROPLETS_INTERNAL_URL ?? "http://localhost:8000";
/** Browser-facing address, written onto every fragment. */
export const DROPLETS_PUBLIC_URL = env.DROPLETS_PUBLIC_URL ?? "http://localhost:8000";

/** GET /droplets/<id>?props -> the droplet element's fragment, or an inline error. */
export async function fragment(
  fetchFn: typeof fetch,
  droplet: string,
  props: Record<string, string> = {},
): Promise<string> {
  const url = new URL(`/droplets/${encodeURIComponent(droplet)}`, DROPLETS_INTERNAL_URL);
  for (const [key, value] of Object.entries(props)) url.searchParams.set(key, value);
  try {
    const response = await fetchFn(url, { headers: { "x-droplet-location": DROPLETS_PUBLIC_URL } });
    if (!response.ok) return `<p class="error">droplet "${droplet}" unavailable: HTTP ${response.status}</p>`;
    return await response.text();
  } catch (error) {
    return `<p class="error">droplet "${droplet}" unavailable: ${String(error)}</p>`;
  }
}
