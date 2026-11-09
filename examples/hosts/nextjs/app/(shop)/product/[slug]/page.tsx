import { notFound } from "next/navigation";
import { pick } from "@/lib/shop";
import { findProduct, Fragment, queryOf, ShopShell, shopPage, STACK, type SearchParams } from "@/lib/shop-page";

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }) {
  const found = await findProduct((await params).slug);
  return { title: `${found ? found.name : "Not found"} · Droplets Shop on ${STACK}` };
}

export default async function Product({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { slug } = await params;
  const found = await findProduct(slug);
  if (!found) notFound();

  const query = queryOf(await searchParams);
  const comments = pick(query, ["order", "page", "showing"]);
  comments.set("productId", found.id);
  // `v`, when the link had one: the shop serves its build's page for the
  // current version and redirects an old one to this URL without it.
  const pageProps = pick(query, ["v"]);
  pageProps.set("slug", found.slug);
  const path = `/product/${encodeURIComponent(slug)}${query.size ? `?${query}` : ""}`;
  const { toasts, cart, fragments, preloads } = await shopPage(path, [
    ["product-page", pageProps],
    ["product-comments", comments],
  ]);
  return (
    <ShopShell toasts={toasts} cart={cart} preloads={preloads}>
      <nav className="shop-crumbs" aria-label="Breadcrumb">
        <a href="/gallery">Gallery</a> ›{" "}
        <a href={`/gallery?${new URLSearchParams({ category: found.category.slug })}`}>{found.category.name}</a> ›{" "}
        <span aria-current="page">{found.name}</span>
      </nav>
      <Fragment html={fragments[0]!} />
      <section className="shop-comments">
        <Fragment html={fragments[1]!} />
      </section>
    </ShopShell>
  );
}
