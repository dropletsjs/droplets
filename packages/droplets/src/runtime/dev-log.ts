/**
 * The runtime's warnings, for `vite dev` and the build's prerender. The app
 * those run in Node directly, where `import.meta.env` does not exist, so
 * they hand this to `createDropletsApp` (`devLog`) instead of a DEV gate; a
 * production server has none, and its bundle holds neither these messages
 * nor the logger.
 *
 * @module
 */
import { logger } from "../core/logger.ts";

/** Where "Trusting any location" is explained, for the warning `"*"` gets. */
const ANY_LOCATION_DOCS = "https://dropletsjs.dev/guides/security/#trusting-any-location";

export type DevLog = {
  /** A location header whose origin is not trusted, once per header. */
  untrustedLocation(input: { location: string; source: string }): void;
  /** A `"*"` in `option`, which trusts any location a request's headers name. */
  anyLocation(input: { option: string }): void;
  /** An entry of `DROPLETS_ORIGIN` or `DROPLETS_TRUSTED_ORIGINS` that is skipped. */
  badEnvEntry(input: { variable: "DROPLETS_ORIGIN" | "DROPLETS_TRUSTED_ORIGINS"; entry: string }): void;
  /** `DROPLETS_SECRET` missing or too short, once each. */
  secret(input: { problem: "missing" | "short"; minBytes: number }): void;
  /** `cors` allows every origin, once. */
  corsAny(): void;
  malformedProps(): void;
  /** An action's result that does not fit a URL value. */
  resultTooLarge(input: { droplet: string; action: string }): void;
};

/** A dev log of its own: each "once" counts per app. */
export function createDevLog(): DevLog {
  const once = new Set<string>();
  function first(key: string): boolean {
    if (once.has(key)) return false;
    once.add(key);
    return true;
  }
  return {
    untrustedLocation({ location, source }) {
      if (!first(`location:${source}`)) return;
      logger.warn(
        "framework",
        `ignoring the location ${JSON.stringify(location.slice(0, 200))} from ${source}: its origin must be this server's or listed in origin or trustedOrigins (or DROPLETS_ORIGIN, DROPLETS_TRUSTED_ORIGINS)`,
      );
    },
    anyLocation({ option }) {
      logger.warn("framework", `${option}: "*" trusts any forwarded location; see ${ANY_LOCATION_DOCS}`);
    },
    badEnvEntry({ variable, entry }) {
      const example =
        variable === "DROPLETS_ORIGIN"
          ? "a location such as https://shop.example or https://shop.example/mfe"
          : "an origin such as https://shop.example";
      logger.warn("framework", `${variable}: ignoring ${JSON.stringify(entry)}, not ${example}`);
    },
    secret({ problem, minBytes }) {
      if (!first(`secret:${problem}`)) return;
      logger.warn(
        "framework",
        problem === "missing"
          ? "DROPLETS_SECRET is not set: a form posted without JavaScript gets the droplet's fragment instead of a redirect back to the page (Post/Redirect/Get). Set it to 32 or more random bytes, e.g. the output of `openssl rand -base64 32`."
          : `DROPLETS_SECRET is shorter than ${minBytes} bytes and is ignored: forms posted without JavaScript get the droplet's fragment instead of a redirect back to the page. It should be ${minBytes} or more random bytes, e.g. the output of \`openssl rand -base64 32\`.`,
      );
    },
    corsAny() {
      if (!first("cors")) return;
      logger.warn(
        "framework",
        "cors allows every origin: Access-Control-Allow-Origin: * on every route (/api/*, _data, /index.js included); list the hosts' origins instead ({ origin: [...] }) for anything not public",
      );
    },
    malformedProps() {
      logger.warn("framework", "ignoring malformed x-droplet-props header");
    },
    resultTooLarge({ droplet, action }) {
      logger.warn(
        "framework",
        `${droplet}: the result of action ${action} is over 2 KB as a URL value; it goes back to the page without its data (status and action only). Return less: field names and messages.`,
      );
    },
  };
}
