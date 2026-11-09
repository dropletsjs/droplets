import { ShopShell, shopPage } from "@/lib/shop-page";

/** An unknown slug: a 404, in the shop's layout. */
export default async function ProductNotFound() {
  const { toasts, cart, preloads } = await shopPage("/gallery", []);
  return (
    <ShopShell toasts={toasts} cart={cart} preloads={preloads}>
      <div className="shop-narrow shop-notice">
        <h1>Not found</h1>
        <p>This product does not exist.</p>
        <p>
          <a href="/gallery">Back to the gallery</a>
        </p>
      </div>
    </ShopShell>
  );
}
