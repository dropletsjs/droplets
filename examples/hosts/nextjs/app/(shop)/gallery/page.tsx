import { Fragment, queryOf, ShopShell, shopPage, STACK, type SearchParams } from "@/lib/shop-page";

export const metadata = { title: `Gallery · Droplets Shop on ${STACK}` };

export default async function Gallery({ searchParams }: { searchParams: SearchParams }) {
  // The whole query to both: the shop drops what a droplet does not take.
  const query = queryOf(await searchParams);
  const { toasts, cart, fragments, preloads } = await shopPage(`/gallery${query.size ? `?${query}` : ""}`, [
    ["product-filter", query],
    ["product-library", query],
  ]);
  return (
    <ShopShell toasts={toasts} current="/gallery" cart={cart} preloads={preloads}>
      <section className="shop-hero">
        <h1>Everything a demo shop needs.</h1>
        <p>Rendered by six frameworks, embedded by {STACK}.</p>
      </section>
      <div className="shop-gallery">
        <aside>
          <Fragment html={fragments[0]!} />
        </aside>
        <div>
          <Fragment html={fragments[1]!} />
        </div>
      </div>
    </ShopShell>
  );
}
