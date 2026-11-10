/**
 * The docs as a host of the demo droplets (apps/demo): at build, the
 * fragment of each live droplet is fetched from the demo server and
 * inlined into the page, as a server-side include would; in the browser,
 * the page loads `/index.js` from the demo's public origin, which hydrates
 * the fragments, posts their forms and loads their styles from there.
 *
 * - `DEMO_URL`: where this build reaches the demo server. `pnpm docs:build`
 *   (scripts/with-demo.mjs) starts a local one and sets it; `pnpm docs:dev`
 *   points it at the demo's dev server.
 * - `DEMO_PUBLIC_URL`: where browsers reach it. Default
 *   https://demo.dropletsjs.dev. Sent as `x-host`, so the URLs a fragment
 *   writes (its stylesheet, its form actions) are on that origin.
 */

/** The element apps/demo renders in (its droplets.config.ts). */
export const DEMO_ELEMENT = "djs-demo";

const DEFAULT_PUBLIC = "https://demo.dropletsjs.dev";

/** An `http(s)` origin, with a path prefix if any, without a trailing slash. */
function location(name: string, value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an http(s) URL, got "${value}"`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`${name} must be an http(s) URL, got "${value}"`);
  return `${url.origin}${url.pathname}`.replace(/\/$/, "");
}

/** Where browsers load the demo from. */
export const demoPublicUrl = (): string => location("DEMO_PUBLIC_URL", process.env["DEMO_PUBLIC_URL"] || DEFAULT_PUBLIC);

/** Where this build fetches fragments from. */
function demoUrl(): string {
  const value = process.env["DEMO_URL"];
  if (!value) {
    throw new Error(
      "DEMO_URL is not set: the live droplets need the demo server. Run `pnpm docs:build` or `pnpm docs:dev` " +
        "at the repository root, which start it, or set DEMO_URL to a running one.",
    );
  }
  return location("DEMO_URL", value);
}

export type Fragment = { html: string; failed: boolean };

/**
 * The droplet's fragment for `props`, rendered for `page` (its `host`: the
 * page it will be part of, so a form posted without JavaScript comes back
 * here). A load that throws is a fragment too (the error page, `500`);
 * anything else that is not a fragment of `<djs-demo>` fails the build.
 */
export async function fetchFragment(id: string, props: Record<string, unknown>, page: string): Promise<Fragment> {
  const url = `${demoUrl()}/droplets/${encodeURIComponent(id)}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/html", "x-host": demoPublicUrl() },
      body: JSON.stringify({ host: page, props }),
      // A redirect is the droplet's answer for a page, never followed by a host.
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new Error(`live droplet "${id}": the demo server at ${url} did not answer (${String(error)})`);
  }
  const html = (await response.text()).trim();
  const isFragment = html.startsWith(`<${DEMO_ELEMENT} data-droplet="${id}"`) && html.endsWith(`</${DEMO_ELEMENT}>`);
  const failed = response.status === 500 && isFragment && /^<[^>]* data-droplet-error[\s>]/.test(html);
  if (!isFragment || (response.status !== 200 && !failed)) {
    throw new Error(`live droplet "${id}": ${url} answered ${response.status}, not a fragment:\n${html.slice(0, 300)}`);
  }
  return { html, failed };
}
