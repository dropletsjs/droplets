import { env } from "$droplets/env/private";
import { fail, type ActionEvent } from "$droplets/server";
import { checkCredentials, createSession, readSession, type Admin } from "./auth.ts";

// The environment side of auth.ts: the configured admin and secret.

/** `.env.example`'s values start with this; a real deployment sets its own. */
const DEMO_SECRET = /^demo-only-/;
let refusedDemo = false;

/**
 * SHOP_SECRET when it is long enough to sign with, else `undefined` (no
 * sessions). The demo value is refused once the server runs in production
 * (NODE_ENV), said once in the log: the login answers 503 until a real one is set.
 */
export function sessionSecret(): string | undefined {
  const secret = env.SHOP_SECRET;
  if (!secret || secret.length < 32) return undefined;
  if (process.env.NODE_ENV === "production" && DEMO_SECRET.test(secret)) {
    if (!refusedDemo) console.error("[shop] SHOP_SECRET is the demo value from .env.example: refused in production, no admin sessions");
    refusedDemo = true;
    return undefined;
  }
  return secret;
}

/** The session name: ADMIN_USER when it fits a cookie token, else "admin". */
const adminName = () => (/^[A-Za-z0-9_-]{1,40}$/.test(env.ADMIN_USER ?? "") ? env.ADMIN_USER! : "admin");

export const verifyLogin = (user: string, password: string) =>
  checkCredentials(user, password, { user: env.ADMIN_USER, password: env.ADMIN_PASSWORD });

/** A fresh session token, or `undefined` when the server cannot sign one. */
export function newSession(): string | undefined {
  const secret = sessionSecret();
  return secret ? createSession(adminName(), secret) : undefined;
}

export const sessionAdmin = (token: string | undefined): Admin | null => readSession(token, sessionSecret());

/** Every admin action starts here: `fail(401)` without a session. */
export function requireAdmin({ locals }: Pick<ActionEvent, "locals">) {
  return locals.admin ? null : fail(401, { reason: "login" as const, message: "Your session has ended. Log in again." });
}
