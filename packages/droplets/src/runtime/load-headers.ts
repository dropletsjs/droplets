/**
 * `setHeaders` on a droplet's load event, as in SvelteKit: the headers its
 * fragment and `_data` answers carry. Plain strings only, each header once,
 * never `set-cookie` (cookies go through `cookies`).
 */
import type { SetHeaders } from "./server.ts";

/** RFC 9110 `token`. */
const FIELD_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
/** What would split or end a header: no value may carry it. */
const FORBIDDEN_VALUE = /[\r\n\0]/;

export type LoadHeaders = {
  setHeaders: SetHeaders;
  /** What the load set, in order. */
  headers: Headers;
};

type CreateLoadHeadersInput = { droplet: string };

/** A `setHeaders` for `droplet`, and the headers it collects. */
export function createLoadHeaders({ droplet }: CreateLoadHeadersInput): LoadHeaders {
  const headers = new Headers();
  const setHeaders: SetHeaders = (values) => {
    if (typeof values !== "object" || values === null || Array.isArray(values)) {
      throw new TypeError(`${droplet}: setHeaders takes an object of header names and string values`);
    }
    for (const name of Object.keys(values)) {
      const value: unknown = values[name];
      if (!FIELD_NAME.test(name)) throw new TypeError(`${droplet}: setHeaders: ${JSON.stringify(name)} is not a header name`);
      if (typeof value !== "string" || FORBIDDEN_VALUE.test(value)) {
        throw new TypeError(`${droplet}: setHeaders: the value of ${name} must be a string without line breaks`);
      }
      const lower = name.toLowerCase();
      if (lower === "set-cookie") {
        throw new Error(`${droplet}: setHeaders cannot set set-cookie; cookies are set in form actions, handle or +server.ts`);
      }
      if (headers.has(lower)) throw new Error(`${droplet}: setHeaders: ${name} is already set`);
      headers.set(lower, value);
    }
  };
  return { setHeaders, headers };
}

type StoredHeadersInput = { value: unknown };

/** Stored headers back as a list, keeping only string values with valid names. */
export function storedHeaders({ value }: StoredHeadersInput): Array<[string, string]> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
  const found: Array<[string, string]> = [];
  for (const name of Object.keys(value)) {
    const header: unknown = (value as Record<string, unknown>)[name];
    const lower = name.toLowerCase();
    if (!FIELD_NAME.test(name) || lower === "set-cookie") continue;
    if (typeof header !== "string" || FORBIDDEN_VALUE.test(header)) continue;
    found.push([lower, header]);
  }
  return found;
}
