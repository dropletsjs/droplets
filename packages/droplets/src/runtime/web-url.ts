/**
 * What a URL a client sent may be: a web URL, and a host within
 * `trustedOrigins`. Shared by the runtime and `$droplets/server`, with no
 * imports of its own.
 */

/** An `http:` or `https:` URL, without credentials or hash; `null` for anything else. */
export function webUrl(value: unknown): URL | null {
  let url: URL;
  try {
    if (value instanceof URL) url = new URL(value.href);
    else if (typeof value === "string" && value !== "") url = new URL(value);
    else return null;
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  url.username = "";
  url.password = "";
  url.hash = "";
  return url;
}

/**
 * Whether `host` may stand: always without a `trustedOrigins` list (or with
 * `"*"`); with one, when its origin is listed or is this server's own.
 */
export function withinTrusted(host: URL, trusted: readonly string[], own: readonly string[]): boolean {
  if (trusted.length === 0 || trusted.includes("*")) return true;
  return trusted.includes(host.origin) || own.includes(host.origin);
}

/**
 * Whether `prefix` may be the path a droplets server is served under: it
 * starts with `/`, has no `//`, `\`, `..`, `?`, `#` or control characters,
 * and is at most 256 characters. A proxy's header can name it, so nothing
 * that could turn into another path, origin or query passes.
 */
export function isLocationPrefix(prefix: string): boolean {
  return prefix.startsWith("/") && prefix.length <= 256 && !/\/\/|\\|\.\.|[?#\u0000-\u001f\u007f]/.test(prefix);
}
