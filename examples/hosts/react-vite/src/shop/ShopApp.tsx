import { useEffect, useState, type ReactNode } from "react";
import { onLinkClick, replace } from "../router.ts";
import { fetchProduct, ShopClientDroplet, ShopFragment, type ShopProduct } from "./ShopDroplet.tsx";
import "./shop.css";

/** The stack this host is, in the footer: the one thing that differs between hosts. */
const STACK = "React 19 + Vite";

/** The routes this app renders the shop demo on; everything else is the Svelte example. */
export const isShopPath = (path: string) => /^\/(?:gallery|login|admin|product\/[^/]+)\/?$/.test(path);

/** The query parameters of `query` named in `keys`, in that order. */
const pick = (query: URLSearchParams, keys: string[]) => {
  const picked = new URLSearchParams();
  for (const key of keys) for (const value of query.getAll(key)) picked.append(key, value);
  return picked;
};

/**
 * The shop demo (examples/shop, see its CONTRACT.md) as client-rendered
 * pages: the same layout every host in examples/hosts/ builds, composed in the
 * browser from fragments fetched through this app's same-origin proxy.
 */
export function ShopApp({ location }: { location: URL }) {
  // The basic page's inline body style is not the shop's: swap it while a shop page is up.
  useEffect(() => {
    const { body } = document;
    const style = body.getAttribute("style");
    body.removeAttribute("style");
    body.classList.add("shop");
    return () => {
      body.classList.remove("shop");
      if (style !== null) body.setAttribute("style", style);
    };
  }, []);

  const path = location.pathname.replace(/\/$/, "");
  const query = location.searchParams;
  const slug = /^\/product\/([^/]+)$/.exec(path)?.[1];

  let page: ReactNode;
  if (path === "/gallery") page = <Gallery query={query} />;
  else if (path === "/login") page = <Page title="Log in"><div className="shop-narrow"><ShopFragment id="login" query={pick(query, ["next"])} /></div></Page>;
  else if (path === "/admin") page = <Page title="Admin"><ShopFragment id="product-admin" query={pick(query, ["view", "id"])} /></Page>;
  else if (slug) page = <Product slug={slug} query={query} />;

  return (
    <>
      {/* First: the toasts. Client-only, they stay across pages; /index.js installs their queue. */}
      <ShopClientDroplet id="toast-center" params={{}} />
      <header className="shop-header">
        <div className="shop-wrap">
          <a className="shop-logo" href="/gallery" onClick={onLinkClick}>
            <span aria-hidden="true">◆</span> Droplets Shop
          </a>
          <nav className="shop-nav" aria-label="Shop">
            {[
              ["/gallery", "Gallery"],
              ["/admin", "Admin"],
            ].map(([href, label]) => (
              <a key={href} href={href} onClick={onLinkClick} aria-current={href === path ? "page" : undefined}>
                {label}
              </a>
            ))}
          </nav>
          <div className="shop-cart">
            {/* Client-only: the badge fetches the cart itself, with this origin's cookie. */}
            <ShopClientDroplet id="shopping-cart" params={{ variant: "badge" }} />
          </div>
        </div>
      </header>
      <main className="shop-main shop-wrap">{page}</main>
      <footer className="shop-footer">
        <div className="shop-wrap">
          <p className="shop-stack">{STACK}</p>
          <p>Droplets demo shop · host: {STACK} · droplets: &lt;djs-shop&gt;</p>
          <p>
            <a href="/gallery" onClick={onLinkClick}>Gallery</a> · <a href="/admin" onClick={onLinkClick}>Admin</a> ·{" "}
            <a href="/" onClick={onLinkClick}>The Svelte example</a>
          </p>
        </div>
      </footer>
    </>
  );
}

function Page({ title, children }: { title: string; children: ReactNode }) {
  useEffect(() => {
    document.title = `${title} · Droplets Shop on ${STACK}`;
  }, [title]);
  return <>{children}</>;
}

function Gallery({ query }: { query: URLSearchParams }) {
  // The whole query to both: the shop drops what a droplet does not take.
  return (
    <Page title="Gallery">
      <section className="shop-hero">
        <h1>Everything a demo shop needs.</h1>
        <p>Rendered by six frameworks, embedded by {STACK}.</p>
      </section>
      <div className="shop-gallery">
        <aside>
          <ShopFragment id="product-filter" query={query} />
        </aside>
        <div>
          <ShopFragment id="product-library" query={query} />
        </div>
      </div>
    </Page>
  );
}

function Product({ slug, query }: { slug: string; query: URLSearchParams }) {
  const [product, setProduct] = useState<ShopProduct | null | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    setProduct(undefined);
    fetchProduct(slug, controller.signal).then(setProduct, () => {
      if (!controller.signal.aborted) setProduct(null);
    });
    return () => controller.abort();
  }, [slug]);

  if (product === undefined) return <Page title="Product">{null}</Page>;
  if (product === null) {
    return (
      <Page title="Not found">
        <div className="shop-narrow shop-notice">
          <h1>Not found</h1>
          <p>This product does not exist.</p>
          <p>
            <a href="/gallery" onClick={onLinkClick}>Back to the gallery</a>
          </p>
        </div>
      </Page>
    );
  }

  const comments = pick(query, ["order", "page", "showing"]);
  comments.set("productId", product.id);
  // `v`, when the link had one: the shop serves its build's page for the
  // current version and redirects an old one, here to this URL without it.
  const page = pick(query, ["v"]);
  page.set("slug", product.slug);
  const withoutV = () => {
    const next = new URLSearchParams(query);
    next.delete("v");
    replace(`/product/${encodeURIComponent(slug)}${next.size ? `?${next}` : ""}`);
  };
  return (
    <Page title={product.name}>
      <nav className="shop-crumbs" aria-label="Breadcrumb">
        <a href="/gallery" onClick={onLinkClick}>Gallery</a> ›{" "}
        <a href={`/gallery?${new URLSearchParams({ category: product.category.slug })}`} onClick={onLinkClick}>
          {product.category.name}
        </a>{" "}
        › <span aria-current="page">{product.name}</span>
      </nav>
      <ShopFragment id="product-page" query={page} onRedirect={withoutV} />
      <section className="shop-comments">
        <ShopFragment id="product-comments" query={comments} />
      </section>
    </Page>
  );
}
