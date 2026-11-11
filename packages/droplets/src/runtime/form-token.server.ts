/**
 * The result of a form action posted without JavaScript, carried on the
 * Post/Redirect/Get answer back to the host page as a signed query value:
 *
 *   __droplet_form_<droplet>_<build>=<base64url(JSON)>.<base64url(HMAC-SHA256)>
 *
 * The JSON is `{ status, data?, exp, action }`; the MAC, keyed with
 * `DROPLETS_SECRET`, covers a version tag, the droplet, the build, the page
 * it goes back to (`origin + pathname`) and the encoded JSON (which names
 * the action): a result minted for one page is worthless on another.
 * Reading checks the shape and the length, verifies the MAC with
 * `crypto.subtle.verify` (constant time), and only then parses: plain
 * `JSON.parse`, no reviver, the result copied into null-prototype objects.
 * Web APIs only: every runtime has them.
 *
 * Server only: the secret and the code that signs never reach a browser.
 */
import { logger } from "../core/logger.ts";
import { ACTION_NAME } from "./form.ts";

/** How long a minted result is honoured. */
export const FORM_RESULT_TTL_MS = 5 * 60 * 1000;
/** The clock difference tolerated between the server that minted and the one that reads. */
const CLOCK_SKEW_MS = 60 * 1000;
/** The longest value minted or read: a longer result drops its data. */
export const FORM_RESULT_MAX_LENGTH = 2048;
/** `DROPLETS_SECRET` shorter than this (in UTF-8 bytes) turns the feature off. */
export const FORM_SECRET_MIN_BYTES = 32;

const VERSION = "droplets-form-v2";
/** base64url without padding, one `.`, then 32 bytes of MAC (43 characters). */
const SHAPE = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/;
const FORBIDDEN_NAMES = new Set(["__proto__", "constructor", "prototype"]);
const MAX_DEPTH = 64;

const encoder = new TextEncoder();

/**
 * What the result is bound to: a token of one droplet, build or page is
 * worthless for another. `page` is `origin + pathname` of the page the
 * result goes back to (and of `event.host` when it is read).
 */
export type FormResultScope = { droplet: string; build: string; page: string };

/** A verified result: the action that ran, its status, and its data (`form`). */
export type FormResult = { action: string; status: number; data?: unknown };

type ToBase64UrlInput = { bytes: Uint8Array };

function toBase64Url({ bytes }: ToBase64UrlInput): string {
  let binary = "";
  // Chunked: spreading a large array into fromCharCode overflows the stack.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

type FromBase64UrlInput = { text: string };

/** `null` for anything that is not base64url. */
function fromBase64Url({ text }: FromBase64UrlInput): Uint8Array<ArrayBuffer> | null {
  try {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    // `atob` refuses it: not base64url.
    return null;
  }
}

let warnedMissing = false;
let warnedShort = false;

export type FormSecretInput = { raw: string | undefined };

/**
 * `DROPLETS_SECRET` when it is usable: at least 32 bytes. Without it (or
 * shorter), `null`, and a warning naming the variable, once per process.
 */
export function formSecret({ raw }: FormSecretInput): string | null {
  if (raw === undefined || raw === "") {
    if (!warnedMissing) {
      warnedMissing = true;
      logger.warn(
        "framework",
        "DROPLETS_SECRET is not set: a form posted without JavaScript gets the droplet's fragment instead of a redirect back to the page (Post/Redirect/Get). Set it to 32 or more random bytes, e.g. the output of `openssl rand -base64 32`.",
      );
    }
    return null;
  }
  if (encoder.encode(raw).length < FORM_SECRET_MIN_BYTES) {
    if (!warnedShort) {
      warnedShort = true;
      logger.warn(
        "framework",
        `DROPLETS_SECRET is shorter than ${FORM_SECRET_MIN_BYTES} bytes and is ignored: forms posted without JavaScript get the droplet's fragment instead of a redirect back to the page. It should be ${FORM_SECRET_MIN_BYTES} or more random bytes, e.g. the output of \`openssl rand -base64 32\`.`,
      );
    }
    return null;
  }
  return raw;
}

/** The HMAC key of the last secret: the env may change per request (Workers), rarely. */
let cachedKey: { secret: string; key: Promise<CryptoKey> } | undefined;

type HmacKeyInput = { secret: string };

function hmacKey({ secret }: HmacKeyInput): Promise<CryptoKey> {
  if (cachedKey?.secret !== secret) {
    const key = crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
    cachedKey = { secret, key };
  }
  return cachedKey.key;
}

type MacInputInput = { scope: FormResultScope; payload: string };

/**
 * What the MAC covers. NUL cannot occur in a droplet id, a build hash or a
 * URL's origin and path (a URL percent-encodes it), nor in base64url.
 */
function macInput({ scope, payload }: MacInputInput): Uint8Array<ArrayBuffer> {
  return encoder.encode(`${VERSION}\u0000${scope.droplet}\u0000${scope.build}\u0000${scope.page}\u0000${payload}`);
}

type SealInput = { secret: string; scope: FormResultScope; body: Record<string, unknown> };

async function seal({ secret, scope, body }: SealInput): Promise<string> {
  const payload = toBase64Url({ bytes: encoder.encode(JSON.stringify(body)) });
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey({ secret }), macInput({ scope, payload })));
  return `${payload}.${toBase64Url({ bytes: mac })}`;
}

export type MintFormResultInput = { secret: string; scope: FormResultScope; result: FormResult; now?: number };

/** A minted value; `dropped` when it had to leave `data` out to fit. */
export type MintedFormResult = { value: string; dropped: boolean };

/**
 * The signed value for `result`, valid for five minutes from `now`. A value
 * longer than 2 KB is minted again without `data` (`dropped: true`), keeping
 * the status and the action.
 */
export async function mintFormResult({ secret, scope, result, now = Date.now() }: MintFormResultInput): Promise<MintedFormResult> {
  const exp = now + FORM_RESULT_TTL_MS;
  const base = { status: result.status, exp, action: result.action };
  if (result.data !== undefined) {
    const value = await seal({ secret, scope, body: { status: result.status, data: result.data, exp, action: result.action } });
    if (value.length <= FORM_RESULT_MAX_LENGTH) return { value, dropped: false };
    return { value: await seal({ secret, scope, body: base }), dropped: true };
  }
  return { value: await seal({ secret, scope, body: base }), dropped: false };
}

/** Marks a value `plainCopy` refuses. */
const REFUSED = Symbol("refused");

type PlainCopyInput = { value: unknown; depth?: number };

/**
 * Plain JSON data, copied: arrays as arrays, objects as null-prototype
 * objects without a `__proto__` key. What `JSON.parse` gave cannot hold
 * anything else, but nothing is taken on trust.
 */
function plainCopy({ value, depth = 0 }: PlainCopyInput): unknown {
  if (depth > MAX_DEPTH) return REFUSED;
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : REFUSED;
  if (Array.isArray(value)) {
    const items: unknown[] = [];
    for (const item of value) {
      const copy = plainCopy({ value: item, depth: depth + 1 });
      if (copy === REFUSED) return REFUSED;
      items.push(copy);
    }
    return items;
  }
  if (typeof value !== "object") return REFUSED;
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return REFUSED;
  const copy = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(value)) {
    if (key === "__proto__") continue;
    const item = plainCopy({ value: (value as Record<string, unknown>)[key], depth: depth + 1 });
    if (item === REFUSED) return REFUSED;
    copy[key] = item;
  }
  return copy;
}

export type ReadFormResultInput = { secret: string; scope: FormResultScope; value: unknown; now?: number };

/**
 * The result in `value` when it is genuine: the right shape and length, a
 * MAC that verifies for `scope`, not expired (and not minted further ahead
 * than five minutes), an action name, a status of `200` or `400`–`599`,
 * plain data. `null` for anything else; the caller renders as if there
 * were none. Whether the droplet still exports the action is the caller's
 * check.
 */
export async function readFormResult({ secret, scope, value, now = Date.now() }: ReadFormResultInput): Promise<FormResult | null> {
  if (typeof value !== "string" || value.length > FORM_RESULT_MAX_LENGTH) return null;
  const match = SHAPE.exec(value);
  const payload = match?.[1];
  const encodedMac = match?.[2];
  if (payload === undefined || encodedMac === undefined) return null;
  const mac = fromBase64Url({ text: encodedMac });
  if (mac?.length !== 32) return null;
  // The MAC first: nothing of the payload is read before it verifies.
  const genuine = await crypto.subtle.verify("HMAC", await hmacKey({ secret }), mac, macInput({ scope, payload }));
  if (!genuine) return null;

  const bytes = fromBase64Url({ text: payload });
  if (!bytes) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    // Not UTF-8 or not JSON: no result, as for any other bad value.
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const field = (name: string): unknown => (Object.hasOwn(record, name) ? record[name] : undefined);

  const exp = field("exp");
  if (typeof exp !== "number" || !Number.isInteger(exp)) return null;
  if (exp <= now || exp > now + FORM_RESULT_TTL_MS + CLOCK_SKEW_MS) return null;
  const action = field("action");
  if (typeof action !== "string" || !ACTION_NAME.test(action) || FORBIDDEN_NAMES.has(action)) return null;
  const status = field("status");
  if (typeof status !== "number" || !Number.isInteger(status)) return null;
  if (status !== 200 && (status < 400 || status > 599)) return null;

  const result = Object.create(null) as FormResult;
  result.action = action;
  result.status = status;
  if (Object.hasOwn(record, "data")) {
    const data = plainCopy({ value: record["data"] });
    if (data === REFUSED) return null;
    result.data = data;
  }
  return result;
}

/** For tests: the warnings once more. */
export function resetFormSecretWarnings(): void {
  warnedMissing = false;
  warnedShort = false;
}
