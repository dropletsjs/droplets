import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { HOST } from "./record.ts";

/**
 * The WordPress showcase only: `x-wp-shop-service` (wp-shop's writes back,
 * plugin/droplets-embed/shop-identity.php) logs a request in on the
 * product write and nowhere else. The test signs the header itself, as
 * wp-shop does, with the compose file's demo service secret: a valid one
 * on any other route, or sent elsewhere by `rest_route`, `_method` or a
 * method override, is ignored and WordPress's own login applies (none
 * here). The same write signed with the host secret is no good either.
 */
test.skip(!HOST.startsWith("wordpress"), "WordPress only");

const compose = readFileSync(join(import.meta.dirname, "..", "..", "..", "examples", "hosts", "wordpress", "docker-compose.yml"), "utf8");
/** A demo secret from the compose file: the value both services get. */
function demoSecret(name: string): string {
  const values = new Set([...compose.matchAll(new RegExp(`^\\s+${name}: (\\S+)$`, "gm"))].map((match) => match[1]!));
  if (values.size !== 1) throw new Error(`${name}: ${values.size} values in docker-compose.yml`);
  return [...values][0]!;
}
const SERVICE_SECRET = demoSecret("WP_SHOP_SERVICE_SECRET");
const HOST_SECRET = demoSecret("WP_SHOP_HOST_SECRET");

/** As wp-shop signs it (src/lib/server/host-identity.ts), for this method and URI. */
function service(method: string, uri: string, secret = SERVICE_SECRET): string {
  // 30 s, not 60: room for a clock that differs between here and the Docker machine.
  const claims = { sub: "admin", role: "administrator", exp: Math.floor(Date.now() / 1000) + 30, method, path: uri, aud: "wordpress" };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}

type Send = {
  method: string;
  uri: string;
  data?: unknown;
  form?: Record<string, string>;
  headers?: Record<string, string>;
  secret?: string;
};

/** One REST request carrying `x-wp-shop-service`, signed for exactly this method and URI. */
const send = (request: APIRequestContext, { method, uri, data, form, headers = {}, secret }: Send) =>
  request.fetch(uri, {
    method,
    maxRedirects: 0,
    headers: { accept: "application/json", "x-wp-shop-service": service(method, uri, secret), ...headers },
    ...(data === undefined ? {} : { data }),
    ...(form === undefined ? {} : { form }),
  });

async function aProduct(request: APIRequestContext): Promise<{ id: number; stock: number }> {
  const list = await request.get("/wp-json/wp/v2/products?per_page=1&_fields=id,meta");
  expect(list.status()).toBe(200);
  const [product] = (await list.json()) as Array<{ id: number; meta: { shop_stock: number } }>;
  expect(product, "a product").toBeDefined();
  return { id: product!.id, stock: product!.meta.shop_stock };
}

test("x-wp-shop-service writes a product's stock, as the admin", async ({ request }) => {
  const { id, stock } = await aProduct(request);
  const uri = `/wp-json/wp/v2/products/${id}?_fields=id,meta`;
  // The same stock written back: the admin's write goes through, nothing changes.
  const saved = await send(request, { method: "POST", uri, data: { meta: { shop_stock: stock } } });
  expect(saved.status(), await saved.text()).toBe(200);
  expect(await saved.json()).toMatchObject({ id, meta: { shop_stock: stock } });
  // Without the header, WordPress's own login: none.
  const anonymous = await request.post(uri, { data: { meta: { shop_stock: stock } }, maxRedirects: 0 });
  expect(anonymous.status()).toBe(401);
});

test("x-wp-shop-service counts nowhere else", async ({ request }) => {
  const { id, stock } = await aProduct(request);
  /** WordPress's answer to nobody: 401, or 403 (the plugin's own refusal once routed), or what `also` allows. */
  const refused = async (attempt: Send, also: number[] = []) => {
    const answer = await send(request, attempt);
    expect([401, 403, ...also], `${attempt.method} ${attempt.uri}: ${await answer.text()}`).toContain(answer.status());
  };
  // Other routes, each with a valid assertion for exactly that request.
  await refused({ method: "GET", uri: "/wp-json/wp/v2/users/me" });
  await refused({ method: "GET", uri: "/wp-json/wp/v2/users?context=edit" });
  await refused({
    method: "POST",
    uri: "/wp-json/wp/v2/users",
    data: { username: "intruder", email: "intruder@example.com", password: "intruder-password-0123" },
  });
  await refused({ method: "GET", uri: "/wp-json/wp/v2/settings" });
  await refused({ method: "GET", uri: "/wp-json/wp/v2/plugins" });
  await refused({ method: "GET", uri: `/wp-json/wp/v2/products/${id}?context=edit` });
  // The product route, sent elsewhere: another route, another method.
  // `rest_route` does reroute it, to users/me as nobody: user 0, `rest_user_invalid_id` (404).
  await refused({ method: "POST", uri: `/wp-json/wp/v2/products/${id}?rest_route=/wp/v2/users/me`, data: {} }, [404]);
  await refused({ method: "POST", uri: `/wp-json/wp/v2/products/${id}?_method=DELETE` });
  await refused({ method: "POST", uri: `/wp-json/wp/v2/products/${id}?_fields=id`, headers: { "x-http-method-override": "DELETE" } });
  await refused({ method: "DELETE", uri: `/wp-json/wp/v2/products/${id}` });
  // Not wp-shop's write: form fields, an id that is not only digits.
  await refused({ method: "POST", uri: `/wp-json/wp/v2/products/${id}`, form: { "meta[shop_stock]": String(stock) } });
  await refused({ method: "POST", uri: `/wp-json/wp/v2/products/0${id}`, data: { meta: { shop_stock: stock } } });
  // The right write, signed with the other direction's secret.
  await refused({
    method: "POST",
    uri: `/wp-json/wp/v2/products/${id}?_fields=id,meta`,
    data: { meta: { shop_stock: stock } },
    secret: HOST_SECRET,
  });

  // Nothing came of them: the product as it was.
  const still = await request.get(`/wp-json/wp/v2/products/${id}?_fields=id,meta`);
  expect(still.status()).toBe(200);
  expect(await still.json()).toMatchObject({ id, meta: { shop_stock: stock } });
});
