import { env } from "$droplets/env/private";
import { fail, type ActionEvent } from "$droplets/server";
import { checkCredentials, createSession, readSession, type Admin } from "./auth.ts";

// The environment side of auth.ts: the configured admin and secret.

/** SHOP_SECRET when it is long enough to sign with, else `undefined` (no sessions). */
export function sessionSecret(): string | undefined {
  const secret = env.SHOP_SECRET;
  return secret && secret.length >= 32 ? secret : undefined;
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
