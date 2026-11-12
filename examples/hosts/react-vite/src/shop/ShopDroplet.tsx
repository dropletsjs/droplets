import { useEffect, useRef, useState } from "react";

/**
 * The shop's droplets, embedded the single-page-app way. The shop is
 * proxied under this app's own origin (`/index.js`, `/droplets/*`,
 * `/assets/*`, `/api/*`: nginx in the image, `server.proxy` in `vite dev`),
 * so every request below is same-origin: the browser sends the shop's
 * cookies itself and nothing needs CORS.
 */

/** The shop's `element` setting (examples/shop/droplets.config.ts). */
export const SHOP_ELEMENT = "djs-shop";

/** Loads the shop's `/index.js` once: same origin, through the proxy. */
export function ensureShopClient(): void {
  if (document.querySelector('script[src="/index.js"]')) return;
  const script = document.createElement("script");
  script.type = "module";
  script.src = "/index.js";
  document.head.appendChild(script);
}

type FragmentProps = {
  id: string;
  /** The droplet's props, as a query string. */
  query?: URLSearchParams;
  /**
   * When the fragment answers a redirect. Its target is opaque here, so the
   * page decides where to go; without this, the droplet shows as unavailable.
   */
  onRedirect?: () => void;
};

/**
 * `GET /droplets/<id>?<query>`, inserted as it came. React owns the wrapper;
 * the custom element owns everything inside it.
 */
export function ShopFragment({ id, query = new URLSearchParams(), onRedirect }: FragmentProps) {
  const host = useRef<HTMLDivElement>(null);
  const redirected = useRef(onRedirect);
  redirected.current = onRedirect;
  const [error, setError] = useState<string | null>(null);
  const search = query.toString();

  useEffect(() => {
    ensureShopClient();
    const target = host.current;
    if (!target) return;
    const controller = new AbortController();
    const url = `/droplets/${encodeURIComponent(id)}?${search}`;

    fetch(url, { signal: controller.signal, redirect: "manual", headers: { accept: "text/html" } })
      .then(async (response) => {
        // Never followed: in the browser its target is opaque, and following it
        // as a navigation could loop back here. The one GET that redirects is
        // the product page with an old `v`: the page passes `onRedirect`.
        if (response.type === "opaqueredirect") {
          if (redirected.current) return redirected.current();
          throw new Error("redirected");
        }
        // Only an HTML answer is a fragment (a 500 carries the error page); a
        // 400 or 404 is text that may echo the props: never insert it as HTML.
        const isFragment =
          (response.ok || response.status === 500) &&
          (response.headers.get("content-type") ?? "").startsWith("text/html");
        if (!isFragment) throw new Error(`HTTP ${response.status}`);
        const template = document.createElement("template");
        template.innerHTML = await response.text();
        target.replaceChildren(template.content); // the element upgrades on insert
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(String(cause));
      });

    return () => {
      controller.abort();
      target.replaceChildren();
    };
  }, [id, search]);

  return (
    <>
      {error ? <p className="shop-unavailable">The {id} droplet is unavailable ({error}).</p> : null}
      <div ref={host} data-react-host={id} />
    </>
  );
}

/**
 * A client-only droplet: the element with `data-droplet` and `data-params`.
 * It fetches its own data and mounts once its bundle has loaded.
 */
export function ShopClientDroplet({ id, params }: { id: string; params: Record<string, string> }) {
  const host = useRef<HTMLSpanElement>(null);
  const paramsKey = JSON.stringify(params);

  useEffect(() => {
    ensureShopClient();
    const target = host.current;
    if (!target) return;
    const element = document.createElement(SHOP_ELEMENT);
    element.dataset["droplet"] = id;
    element.dataset["params"] = paramsKey;
    target.replaceChildren(element);
    return () => target.replaceChildren();
  }, [id, paramsKey]);

  return <span ref={host} style={{ display: "contents" }} />;
}

export type ShopProduct = {
  id: string;
  slug: string;
  name: string;
  category: { slug: string; name: string };
};

/** A product's id, name and category, from the product page's public `_data` read; `null` when unknown. */
export async function fetchProduct(slug: string, signal: AbortSignal): Promise<ShopProduct | null> {
  const response = await fetch(`/droplets/product-page/_data?${new URLSearchParams({ slug })}`, {
    signal,
    redirect: "manual",
    headers: { accept: "application/json" },
  });
  if (!response.ok) return null;
  const body: unknown = await response.json();
  const product = (body as { data?: { product?: Partial<ShopProduct> } } | null)?.data?.product;
  if (typeof product?.id !== "string" || typeof product.name !== "string") return null;
  return {
    id: product.id,
    slug: String(product.slug ?? slug),
    name: product.name,
    category: {
      slug: String(product.category?.slug ?? ""),
      name: String(product.category?.name ?? ""),
    },
  };
}
