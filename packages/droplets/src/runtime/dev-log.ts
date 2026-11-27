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
import {
  ANY_LOCATION_TRUSTED,
  CORS_ANY_ORIGIN,
  ENV_MAX_AGE_INVALID,
  FORM_RESULT_DROPPED,
  FORM_RESULT_TOO_LARGE,
  FORM_SECRET_MISSING,
  FORM_SECRET_SHORT,
  LOCATION_UNTRUSTED,
  PROPS_HEADER_MALFORMED,
  RENDER_TIMED_OUT,
  TRUSTED_ORIGIN_ENV_INVALID,
} from "../errors/runtime.ts";
import type { FormResultDropReason } from "./form-token.server.ts";

export type DevLog = {
  /** A location header whose origin is not trusted, once per header. */
  untrustedLocation(input: { location: string; source: string }): void;
  /** A `"*"` in `option`, which trusts any location a request's headers name. */
  anyLocation(input: { option: string }): void;
  /** An entry of `DROPLETS_TRUSTED_ORIGINS` that is skipped. */
  badEnvEntry(input: { variable: "DROPLETS_TRUSTED_ORIGINS"; entry: string }): void;
  /** `DROPLETS_SECRET` missing or too short, once each. */
  secret(input: { problem: "missing" | "short"; minBytes: number }): void;
  /** `cors` allows every origin, once. */
  corsAny(): void;
  malformedProps(): void;
  /** A `DROPLETS_ENV_MAX_AGE` that is no number of seconds, once per value. */
  badEnvMaxAge(input: { value: string; fallback: string }): void;
  /** An action's result that does not fit a URL value. */
  resultTooLarge(input: { droplet: string; action: string }): void;
  /** A carried no-JavaScript result that the droplet renders without: every time. */
  formResultDropped(input: { droplet: string; reason: FormResultDropReason; action?: string | undefined }): void;
  /** A fragment or `_data` that answered 504: every time. */
  renderTimeout(input: { droplet: string; timeout: number }): void;
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
      logger.report({ message: LOCATION_UNTRUSTED, params: { location, source } });
    },
    anyLocation({ option }) {
      logger.report({ message: ANY_LOCATION_TRUSTED, params: { option } });
    },
    badEnvEntry({ variable, entry }) {
      logger.report({ message: TRUSTED_ORIGIN_ENV_INVALID, params: { variable, entry } });
    },
    secret({ problem, minBytes }) {
      if (!first(`secret:${problem}`)) return;
      if (problem === "missing") logger.report({ message: FORM_SECRET_MISSING });
      else logger.report({ message: FORM_SECRET_SHORT, params: { minBytes } });
    },
    corsAny() {
      if (!first("cors")) return;
      logger.report({ message: CORS_ANY_ORIGIN });
    },
    malformedProps() {
      logger.report({ message: PROPS_HEADER_MALFORMED });
    },
    badEnvMaxAge({ value, fallback }) {
      logger.report({ message: ENV_MAX_AGE_INVALID, params: { value, fallback } });
    },
    resultTooLarge({ droplet, action }) {
      logger.report({ message: FORM_RESULT_TOO_LARGE, params: { action }, droplet });
    },
    formResultDropped({ droplet, reason, action }) {
      logger.report({ message: FORM_RESULT_DROPPED, params: { reason, action }, droplet });
    },
    renderTimeout({ droplet, timeout }) {
      logger.report({ message: RENDER_TIMED_OUT, params: { timeout }, droplet });
    },
  };
}
