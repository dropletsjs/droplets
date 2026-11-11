import { describe, expect, it } from "vitest";
import { cartAvailability } from "../src/lib/availability.ts";
import { commentEntries } from "../src/lib/comment-entries.ts";
import { fillLive, LIVE_FIELDS, liveToken, type LiveValues } from "../src/lib/live.ts";
import { relativePath } from "../src/lib/schemas.ts";
import { checkCredentials, createSession, readSession, sameSecret } from "../src/lib/server/auth.ts";
import { cartIdFrom } from "../src/lib/server/cart.ts";
import { isImageKey, sniffImage } from "../src/lib/server/images.ts";
import type { CartLine } from "../src/lib/types.ts";

const values = (over: Partial<LiveValues> = {}): LiveValues => ({
  "stock-state": "out",
  "stock-label": "Out of stock",
  "max-qty": "1",
  disabled: "disabled",
  "button-label": "Out of stock",
  price: "€19.20",
  "was-price": "€24.00",
  "sale-hidden": "",
  "sale-pct": "20",
  ...over,
});

describe("the product page's transform replace", () => {
  it("fills every placeholder, in text and attributes", () => {
    const html =
      `<section class="product stock-${liveToken("stock-state")}">` +
      `<p class="stock">${liveToken("stock-label")}</p>` +
      `<button ${liveToken("disabled")}>${liveToken("button-label")}</button></section>`;
    expect(fillLive(html, values())).toBe(
      `<section class="product stock-out"><p class="stock">Out of stock</p><button disabled>Out of stock</button></section>`,
    );
  });

  it("escapes what it writes", () => {
    const html = `<b title="${liveToken("price")}">${liveToken("price")}</b>`;
    expect(fillLive(html, values({ price: `"><script>x</script>` }))).toBe(
      `<b title="&#34;&#62;&#60;script&#62;x&#60;/script&#62;">&#34;&#62;&#60;script&#62;x&#60;/script&#62;</b>`,
    );
  });

  it("leaves no placeholder behind, known or not", () => {
    const html = `${LIVE_FIELDS.map(liveToken).join("|")}|%live:typo%`;
    expect(fillLive(html, values())).not.toContain("%live:");
  });

  it("refuses an unknown field in the template", () => {
    expect(() => liveToken("stok-label")).toThrow(/no live field/);
  });
});

describe("the comments entries rule", () => {
  it("prerenders only oldest-first pages that are full at build", () => {
    const entries = commentEntries([
      { productId: "p_aaaa", count: 23 },
      { productId: "p_bbbb", count: 9 },
      { productId: "p_cccc", count: 50 },
    ]);
    const keys = entries.map(({ props }) => `${props.productId}:${props.showing}:${props.page}`);
    expect(keys).toEqual([
      // 23 comments: two full pages of 10, one of 20, none of 25 or 50.
      "p_aaaa:10:1",
      "p_aaaa:10:2",
      "p_aaaa:20:1",
      // 9 comments: no page is full.
      // 50: five of 10, two of 20 and 25, one of 50.
      "p_cccc:10:1",
      "p_cccc:10:2",
      "p_cccc:10:3",
      "p_cccc:10:4",
      "p_cccc:10:5",
      "p_cccc:20:1",
      "p_cccc:20:2",
      "p_cccc:25:1",
      "p_cccc:25:2",
      "p_cccc:50:1",
    ]);
    expect(entries.every(({ props }) => props.order === "oldest")).toBe(true);
  });
});

describe("the admin session", () => {
  const secret = "s".repeat(32);

  it("signs and verifies", () => {
    expect(readSession(createSession("admin", secret), secret)).toEqual({ name: "admin" });
  });

  it("ignores a tampered, foreign or expired token", () => {
    const token = createSession("admin", secret);
    expect(readSession(token.replace("admin", "root"), secret)).toBeNull();
    expect(readSession(token, "t".repeat(32))).toBeNull();
    expect(readSession(createSession("admin", secret, Date.now() - 9 * 3600_000), secret)).toBeNull();
    expect(readSession(`${token}x`, secret)).toBeNull();
    expect(readSession("admin.1.x", secret)).toBeNull();
    expect(readSession(token, undefined)).toBeNull();
  });

  it("compares credentials in full, and refuses without configured ones", () => {
    expect(sameSecret("droplets", "droplets")).toBe(true);
    expect(sameSecret("droplet", "droplets")).toBe(false);
    expect(checkCredentials("admin", "droplets", { user: "admin", password: "droplets" })).toBe(true);
    expect(checkCredentials("admin", "nope", { user: "admin", password: "droplets" })).toBe(false);
    expect(checkCredentials("", "", { user: undefined, password: undefined })).toBe(false);
  });
});

describe("input shapes", () => {
  it("takes a path on the host as next, never another origin", () => {
    const ok = (value: string) => relativePath["~standard"].validate(value);
    for (const good of ["/admin", "/admin?view=list"]) expect(ok(good)).not.toHaveProperty("issues");
    for (const bad of ["//evil.example", "/\\evil.example", "https://evil.example", "admin", "/a b"]) {
      expect(ok(bad)).toHaveProperty("issues");
    }
  });

  it("takes a cart id only in a UUID's shape", () => {
    expect(cartIdFrom("0f8fad5b-d9cb-469f-a165-70867728950e")).toBe("0f8fad5b-d9cb-469f-a165-70867728950e");
    expect(cartIdFrom("1 OR 1=1")).toBeNull();
    expect(cartIdFrom(undefined)).toBeNull();
  });

  it("takes image keys as file names, never paths, and trusts bytes over names", () => {
    expect(isImageKey("clay-cylinder-mug.webp")).toBe(true);
    expect(isImageKey("../shop.db")).toBe(false);
    expect(isImageKey("x.svg")).toBe(false);
    expect(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("png");
    expect(sniffImage(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
  });
});

describe("the cart drawer's stock check", () => {
  const line = (productId: string, stock: number): CartLine => ({
    productId,
    slug: productId,
    name: productId,
    image: `${productId}.webp`,
    qty: 1,
    unitCents: 1000,
    wasCents: null,
    lineCents: 1000,
    stock,
    stockState: stock <= 0 ? "out" : stock <= 5 ? "low" : "in",
  });
  const lines = [line("p_glass1", 12), line("p_mug001", 3), line("p_gone01", 8), line("p_added1", 9)];

  it("keeps the cart's own figures until the check answers", () => {
    const { lines: shown, out } = cartAvailability(lines, null);
    expect(shown.get("p_glass1")).toEqual({ stock: 12, state: "in" });
    expect(shown.get("p_mug001")).toEqual({ stock: 3, state: "low" });
    expect(out).toEqual([]);
  });

  it("marks what sold out since, and what the shop no longer sells", () => {
    const check = {
      ids: ["p_glass1", "p_mug001", "p_gone01"],
      // p_gone01 was asked about and left out: archived.
      items: [
        { id: "p_glass1", stock: 0 },
        { id: "p_mug001", stock: 3 },
      ],
    };
    const { lines: shown, out } = cartAvailability(lines, check);
    expect(shown.get("p_glass1")).toEqual({ stock: 0, state: "out" });
    expect(shown.get("p_mug001")).toEqual({ stock: 3, state: "low" });
    expect(shown.get("p_gone01")).toEqual({ stock: 0, state: "out" });
    // Added after the check: not asked about, its own figures stand.
    expect(shown.get("p_added1")).toEqual({ stock: 9, state: "in" });
    expect(out).toEqual(["p_glass1", "p_gone01"]);
  });
});
