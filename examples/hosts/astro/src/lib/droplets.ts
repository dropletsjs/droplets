/** Server-to-server address (inside Docker: the service name). */
export const DROPLETS_INTERNAL_URL =
  process.env.DROPLETS_INTERNAL_URL ?? "http://localhost:8000";
/** Browser-facing address, written onto every fragment. */
export const DROPLETS_PUBLIC_URL =
  process.env.DROPLETS_PUBLIC_URL ?? "http://localhost:8000";

const escapeHtml = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!,
  );

/** GET /droplets/<id>?props -> the droplet element's fragment, or an inline error. */
export async function fragment(
  droplet: string,
  props: Record<string, string> = {},
): Promise<string> {
  const url = new URL(`/droplets/${encodeURIComponent(droplet)}`, DROPLETS_INTERNAL_URL);
  for (const [key, value] of Object.entries(props)) url.searchParams.set(key, value);
  try {
    const response = await fetch(url, {
      headers: { accept: "text/html", "x-droplet-location": DROPLETS_PUBLIC_URL },
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    });
    // Only an HTML answer is a fragment (a 500 carries the droplet's error
    // page); anything else may echo the props, so it is never pasted.
    const isFragment =
      (response.ok || response.status === 500) && (response.headers.get("content-type") ?? "").startsWith("text/html");
    if (isFragment) return await response.text();
    await response.body?.cancel();
    return `<p class="error">droplet "${escapeHtml(droplet)}" unavailable: HTTP ${response.status}</p>`;
  } catch (error) {
    return `<p class="error">droplet "${escapeHtml(droplet)}" unavailable: ${escapeHtml(String(error))}</p>`;
  }
}
