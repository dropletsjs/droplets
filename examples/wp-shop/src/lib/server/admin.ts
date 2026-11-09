import { fail, type ActionEvent } from "$droplets/server";
import { adminOf, ASSERTION_HEADER, type HostAdmin, requestPath, verifyAssertion } from "./host-identity.ts";
import { shopSecrets } from "./site.ts";

// The environment side of host-identity.ts: who the request's WordPress
// account is, with the configured secret.

let warned = false;

/**
 * The WordPress admin the request's `x-wp-shop-user` names, or `null`.
 * Without WP_SHOP_HOST_SECRET (32+ bytes), or with it equal to
 * WP_SHOP_SERVICE_SECRET, nothing verifies: there is no admin at all, and
 * that is said once in the log.
 */
export async function hostAdmin(request: Request, url: URL): Promise<HostAdmin | null> {
  const header = request.headers.get(ASSERTION_HEADER);
  if (!header) return null;
  const { host: secret, error } = shopSecrets();
  if (error) return null;
  if (!secret) {
    if (!warned) console.warn("[wp-shop] an x-wp-shop-user came, but WP_SHOP_HOST_SECRET is not set (32+ bytes): no admin");
    warned = true;
    return null;
  }
  const claims = await verifyAssertion(header, secret, { aud: "wp-shop", method: request.method, path: requestPath(url) });
  return claims ? adminOf(claims) : null;
}

/** Every admin action starts here: `fail(401)` without a WordPress admin behind the request. */
export function requireAdmin({ locals }: Pick<ActionEvent, "locals">) {
  return locals.admin
    ? null
    : fail(401, { reason: "login" as const, message: "Your WordPress session has ended. Log in again." });
}
