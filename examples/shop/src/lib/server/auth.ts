import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * One hard-coded admin, no accounts. The login action checks the
 * credentials against ADMIN_USER / ADMIN_PASSWORD in constant time and sets
 * `shop_admin`: `<user>.<expiry>.<HMAC-SHA256 of both>` with SHOP_SECRET,
 * HttpOnly. `handle` verifies it on every request into `locals.admin`. No
 * session store: the signature is the session.
 */
export const ADMIN_COOKIE = "shop_admin";

export const SESSION_SECONDS = 60 * 60 * 8;

export const ADMIN_COOKIE_OPTIONS = { path: "/", maxAge: SESSION_SECONDS, httpOnly: true, sameSite: "lax" } as const;

export type Admin = { name: string };

/** Equal strings, compared in constant time: hashes first, so lengths never leak. */
export function sameSecret(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b) && given.length === expected.length;
}

/** The credentials, checked; `false` when the server has none configured. */
export function checkCredentials(
  user: string,
  password: string,
  expected: { user?: string | undefined; password?: string | undefined },
): boolean {
  if (!expected.user || !expected.password) return false;
  // Both compared every time: a wrong user takes as long as a wrong password.
  const userOk = sameSecret(user, expected.user);
  const passwordOk = sameSecret(password, expected.password);
  return userOk && passwordOk;
}

const sign = (payload: string, secret: string) => createHmac("sha256", secret).update(payload).digest("base64url");

export function createSession(name: string, secret: string, at = Date.now()): string {
  const payload = `${name}.${Math.floor(at / 1000) + SESSION_SECONDS}`;
  return `${payload}.${sign(payload, secret)}`;
}

const TOKEN = /^([A-Za-z0-9_-]{1,40})\.(\d{10})\.([A-Za-z0-9_-]{43})$/;

/** The admin a session cookie names, when its signature holds and it has not expired. */
export function readSession(token: string | undefined, secret: string | undefined, at = Date.now()): Admin | null {
  if (!token || !secret || token.length > 120) return null;
  const match = TOKEN.exec(token);
  if (!match) return null;
  const [, name, exp, mac] = match as unknown as [string, string, string, string];
  const expected = Buffer.from(sign(`${name}.${exp}`, secret));
  const given = Buffer.from(mac);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  if (Number(exp) * 1000 <= at) return null;
  return { name };
}
