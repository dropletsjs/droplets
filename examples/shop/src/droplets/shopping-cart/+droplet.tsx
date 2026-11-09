/** @jsxImportSource react */
import { use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { actionUrl } from "$droplets/form";
import { useEnhanceDropletForm } from "@dropletsjs/renderer-react/form";
import { checkStock, getCart, imageUrl } from "../../lib/api.ts";
import { atLeast, cartAvailability, type StockCheck } from "../../lib/availability.ts";
import { CART_ACTIONS, emit, isRecord, on, onDropletAction } from "../../lib/events.ts";
import { formatMoney, productHref, stockLabel } from "../../lib/format.ts";
import type { Cart } from "../../lib/types.ts";
import type { DropletActions, DropletProps } from "./$types";
import "./cart.css";

// Client-only: the badge in the host's header and the drawer it opens.
// The server load reads the `cart_id` cookie and its result comes inline,
// so the count is right when the bundle mounts. Afterwards it follows:
// - `droplets:action`, after another droplet's enhanced `?/add`;
// - `shop:cart-changed` from another cart or a host using /api/cart/items;
// - `shop:product-changed` (stock or price changed), `shop:cart-open`.
// Opened, it checks its lines' stock (`/api/stock/check`, the ids alone):
// "Checking availability…" until the answer, then a sold-out line says so
// and the footer warns.
export const ssr = false;
export const hydrate = true;

const isCart = (value: unknown): value is Cart =>
  isRecord(value) && typeof value["count"] === "number" && Array.isArray(value["items"]);

export default function ShoppingCart({ data, form }: DropletProps) {
  const initial = data instanceof Promise ? use(data) : data;
  const [cart, setCart] = useState<Cart>(initial.cart);
  const inline = initial.variant === "inline";
  const [open, setOpen] = useState(false);
  const [pulse, setPulse] = useState(0);
  // The stock check's answer for the lines, and whether one is under way.
  const [checked, setChecked] = useState<StockCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const close = useRef<HTMLButtonElement>(null);
  // Its own forms, enhanced: a result with the cart shows in place, the
  // drawer stays open; anything else renders the droplet with `form`.
  // Named with the droplet and its props: the component may suspend on
  // `data` before its first render is done, so it cannot rely on the render
  // in progress.
  const urls = useMemo(() => {
    const at = (name: "setQty" | "remove" | "clear") =>
      actionUrl<DropletActions>(name, { droplet: "shopping-cart", props: { variant: initial.variant } });
    return { setQty: at("setQty"), remove: at("remove"), clear: at("clear") };
  }, [initial.variant]);

  const show = useCallback((next: Cart) => {
    setCart((before) => {
      if (next.count !== before.count) setPulse((n) => n + 1);
      return next;
    });
  }, []);
  const refetch = useCallback(() => void getCart().then(show).catch(() => {}), [show]);

  // A load that ran again after one of this droplet's actions.
  useEffect(() => show(initial.cart), [initial, show]);

  // This droplet's own action result: show it, and tell other carts on the page.
  const applied = useCallback((result: unknown) => {
    if (!isCart(result)) return false;
    show(result);
    emit("shop:cart-changed", { count: result.count, cart: result });
    return true;
  }, [show]);
  useEffect(() => void applied(isRecord(form) ? form["cart"] : undefined), [form, applied]);

  useEffect(() => {
    const stops = [
      onDropletAction(({ droplet, action, type }) => {
        if (type === "success" && CART_ACTIONS.has(`${droplet}:${action}`)) refetch();
      }),
      on("shop:cart-changed", (detail) => {
        if (isRecord(detail) && isCart(detail["cart"])) show(detail["cart"]);
        else refetch();
      }),
      on("shop:product-changed", refetch),
      on("shop:cart-open", () => setOpen(true)),
    ];
    return () => stops.forEach((stop) => stop());
  }, [refetch, show]);

  // On open: the stock right now, so a line that sold out says so.
  useEffect(() => {
    if (!open && !inline) return;
    if (!inline) close.current?.focus();
    // What the check takes at most (50): a line past that keeps its own figures.
    const ids = cart.items.slice(0, 50).map((line) => line.productId);
    // Closed before the answer: it is not shown.
    let current = true;
    if (ids.length) {
      setChecking(true);
      // Never a flicker: the state shows for half a second at least.
      void atLeast(checkStock(ids), 500)
        .then((items) => current && setChecked({ ids, items }))
        .catch(() => {})
        .finally(() => current && setChecking(false));
    }
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      current = false;
      setChecking(false);
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, inline]);

  const availability = cartAvailability(cart.items, checked);
  const outCount = availability.out.length;

  const panel = (
    <>
    {cart.items.length
      ? (
        <ul className="cart-lines" aria-busy={checking}>
          {cart.items.map((line) => {
            const now = availability.lines.get(line.productId) ?? { stock: line.stock, state: line.stockState };
            return (
              <li key={line.productId} className={!checking && now.state === "out" ? "cart-line out" : "cart-line"}>
                <img src={imageUrl(line.image)} alt="" width={64} height={64} />
                <div>
                  <a href={productHref(line.slug, line.v)}>{line.name}</a>
                  <p className="cart-price">
                    {formatMoney(line.unitCents, cart.currency)}
                    {line.wasCents !== null ? <s> {formatMoney(line.wasCents, cart.currency)}</s> : null}
                  </p>
                  {checking
                    ? <p className="stock stock-checking">Checking availability…</p>
                    : now.state !== "in"
                    ? <p className={`stock stock-${now.state}`}>{stockLabel(now.state, now.stock)}</p>
                    : null}
                </div>
                <CartForm action={urls.setQty} className="cart-qty" applied={applied}>
                  <input type="hidden" name="productId" value={line.productId} />
                  <button className="button" name="qty" value={line.qty - 1} aria-label="One less">−</button>
                  <span aria-label="Quantity">{line.qty}</span>
                  <button className="button" name="qty" value={line.qty + 1} aria-label="One more" disabled={now.state === "out" || line.qty >= now.stock}>
                    +
                  </button>
                </CartForm>
                <CartForm action={urls.remove} applied={applied}>
                  <input type="hidden" name="productId" value={line.productId} />
                  <button className="cart-remove">Remove</button>
                </CartForm>
              </li>
            );
          })}
        </ul>
      )
      : (
        <div className="cart-empty">
          <p>Your cart is empty.</p>
          <a className="button" href="/gallery">Browse the gallery</a>
        </div>
      )}

    {cart.items.length
      ? (
        <footer>
          <p className="cart-total">
            <span>Subtotal</span> <b>{formatMoney(cart.totalCents, cart.currency)}</b>
          </p>
          {!checking && outCount
            ? (
              <p className="cart-warning" role="alert">
                {outCount === 1 ? "1 item is" : `${outCount} items are`} out of stock: remove {outCount === 1 ? "it" : "them"} to check out.
              </p>
            )
            : null}
          <button type="button" className="button primary" disabled title="A demo shop: no checkout">
            Checkout (demo)
          </button>
          <CartForm action={urls.clear} applied={applied}>
            <button className="cart-remove">Empty the cart</button>
          </CartForm>
        </footer>
      )
      : null}
    </>
  );

  if (inline) {
    return (
      <section className="cart cart-inline" aria-label="Your cart">
        <h2>Your cart {cart.count ? `(${cart.count})` : ""}</h2>
        {panel}
      </section>
    );
  }

  return (
    <div className="cart">
      <button
        type="button"
        className={cart.count ? "cart-badge full" : "cart-badge"}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true">🛒</span> Cart
        {cart.count ? <span key={pulse} className="cart-count">{cart.count}</span> : null}
      </button>

      {open
        ? (
          <div className="cart-layer">
            <div className="cart-backdrop" onClick={() => setOpen(false)} />
            <aside className="cart-drawer" role="dialog" aria-modal="true" aria-label="Your cart">
              <header>
                <h2>Your cart {cart.count ? `(${cart.count})` : ""}</h2>
                <button ref={close} type="button" className="cart-close" aria-label="Close" onClick={() => setOpen(false)}>
                  ×
                </button>
              </header>

              {panel}
            </aside>
          </div>
        )
        : null}
    </div>
  );
}

/** One of the cart's forms, enhanced: a result that carries the cart is `applied` in place. */
function CartForm({ action, className, applied, children }: {
  action: string;
  className?: string;
  applied: (cart: unknown) => boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLFormElement>(null);
  useEnhanceDropletForm<DropletActions>(ref, {
    onResult: ({ type, data, update }) =>
      type === "success" && isRecord(data) && applied(data["cart"]) ? undefined : update(),
  });
  return <form method="post" action={action} className={className} ref={ref}>{children}</form>;
}
