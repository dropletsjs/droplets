import "server-only";
import { headers } from "next/headers";
import { redirect, RedirectType } from "next/navigation";
import type { ReactNode } from "react";
import { cache } from "react";
import { createShop, type Preload } from "./shop";

/** The stack this host is, in the footer: the one thing that differs between hosts. */
export const STACK = "Next.js 16";

export const shop = createShop({
  internalUrl: process.env.SHOP_INTERNAL_URL ?? "http://localhost:8300",
  publicUrl: process.env.SHOP_PUBLIC_URL ?? "http://localhost:8007",
});

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** A page's `searchParams`, back as a query string. */
export function queryOf(params: Record<string, string | string[] | undefined>): URLSearchParams {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, item);
  }
  return query;
}

/** One lookup per request, shared by the page and its metadata. */
export const findProduct = cache((slug: string) => shop.product(slug));

/**
 * Fetches the toasts (first in the body), the header's cart and the page's fragments, as the browser's
 * request asked: its cookies, this page (`path`) as the host. Their `Link`
 * preloads come back for `ShopShell`, which renders them as <link>
 * elements: React puts those in the document's head.
 *
 * Two limits of a server component: it cannot set cookies, so a fragment's
 * `Set-Cookie` is dropped here (every cookie the shop sets today comes from
 * a form post or an API call, which go through the proxy and keep theirs);
 * and it cannot pick a redirect's status, so a droplet's redirect goes out
 * as Next's 307.
 */
export async function shopPage(path: string, wanted: [id: string, params: URLSearchParams][]) {
  const page = { path, cookie: (await headers()).get("cookie") };
  const [toasts, cart, ...fragments] = await Promise.all([
    shop.fragment(page, "toast-center", new URLSearchParams()),
    shop.fragment(page, "shopping-cart", new URLSearchParams({ variant: "badge" })),
    ...wanted.map(([id, params]) => shop.fragment(page, id, params)),
  ]);
  const all = [toasts!, cart!, ...fragments];
  // Never the case with the shop today; said out loud if a droplet starts to.
  const dropped = all.filter((fragment) => fragment.cookies.length > 0).length;
  if (dropped) console.warn(`[shop] ${path}: ${dropped} fragment(s) sent Set-Cookie, which a server component cannot pass on`);
  const moved = all.find((fragment) => fragment.location);
  if (moved) redirect(moved.location!, RedirectType.replace);
  return { toasts: toasts!.html, cart: cart!.html, fragments: fragments.map((fragment) => fragment.html), preloads: shop.preloads(all) };
}

/**
 * A fragment from the shop. Trusted markup from our own droplets server;
 * the droplets hydrate themselves and may change it before React compares.
 */
export function Fragment({ html }: { html: string }) {
  return <div style={{ display: "contents" }} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: html }} />;
}

const NAV = [
  ["/gallery", "Gallery"],
  ["/admin", "Admin"],
];

/** The shop's one layout: the toasts droplet first, the header (logo, nav, the cart badge droplet), the page, the footer. */
export function ShopShell({
  current,
  toasts,
  cart,
  preloads,
  children,
}: {
  current?: string;
  toasts: string;
  cart: string;
  preloads: Preload[];
  children: ReactNode;
}) {
  return (
    <>
      {preloads.map(({ rel, href, as }) => (
        <link key={`${rel} ${href}`} rel={rel} href={href} as={as} />
      ))}
      <Fragment html={toasts} />
      <header className="shop-header">
        <div className="shop-wrap">
          <a className="shop-logo" href="/gallery">
            <span aria-hidden="true">◆</span> Droplets Shop
          </a>
          <nav className="shop-nav" aria-label="Shop">
            {NAV.map(([href, label]) => (
              <a key={href} href={href} aria-current={href === current ? "page" : undefined}>
                {label}
              </a>
            ))}
          </nav>
          <div className="shop-cart">
            <Fragment html={cart} />
          </div>
        </div>
      </header>
      <main className="shop-main shop-wrap">{children}</main>
      <footer className="shop-footer">
        <div className="shop-wrap">
          <p className="shop-stack">{STACK}</p>
          <p>Droplets demo shop · host: {STACK} · droplets: &lt;djs-shop&gt;</p>
          <p>
            <a href="/gallery">Gallery</a> · <a href="/admin">Admin</a> · <a href="/">The Svelte example</a>
          </p>
        </div>
      </footer>
    </>
  );
}
