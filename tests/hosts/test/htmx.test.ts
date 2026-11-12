/**
 * examples/hosts/htmx's shop moves as one page: a link or a form swaps the
 * next page's <main> into this one, so the head, the header and the footer
 * are never read again. They are the same in every shop page, the body
 * says where a navigation goes, and every droplet request sits in a <main>
 * that inherits none of it. nginx gives each page its path.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const htmx = resolve(import.meta.dirname, "../../../examples/hosts/htmx");
const read = (path: string) => readFileSync(join(htmx, path), "utf8");

const PAGES = ["gallery", "product", "login", "admin"] as const;

/** A page with its title, the nav's current link and <main>'s content taken out: what stays across a navigation. */
const frame = (html: string) =>
  html
    .replace(/<title>[^<]*<\/title>/, "<title>")
    .replace(/ aria-current="page"/g, "")
    .replace(/(<main class=[^>]*>)[\s\S]*<\/main>/, "$1</main>");

const main = (html: string) => /<main class=[^>]*>([\s\S]*)<\/main>/.exec(html)?.[1] ?? "";

describe("the htmx host's shop pages", () => {
  const pages = PAGES.map((page) => [page, read(`html/${page}.html`)] as const);

  it("share their head, header and footer", () => {
    const [first, ...rest] = pages.map(([, html]) => frame(html));
    for (const other of rest) expect(other).toBe(first);
  });

  it("swap <main> alone, kept in the history, and load the shop's /index.js once", () => {
    for (const [page, html] of pages) {
      expect(html, page).toContain(
        '<body class="shop" hx-boost="true" hx-target="main" hx-select="main" hx-swap="outerHTML show:window:top">',
      );
      expect(html, page).toMatch(/<main class="shop-main shop-wrap" hx-history-elt hx-disinherit="\*">/);
      expect(html.match(/<script type="module" src="[^"]*"><\/script>/g), page).toEqual([
        '<script type="module" src="/index.js"></script>',
      ]);
      expect(html, page).toContain('<script src="/shop.js"></script>');
    }
  });

  it("ask for every droplet from inside <main>, on this origin", () => {
    for (const [page, html] of pages) {
      const gets = html.match(/hx-get="[^"]*"/g) ?? [];
      expect(gets.length, page).toBeGreaterThan(0);
      expect(main(html).match(/hx-get="[^"]*"/g), page).toEqual(gets);
      for (const get of gets) expect(get, page).toMatch(/^hx-get="\/droplets\/[a-z-]+(?:\?[^"]*)?"$/);
    }
  });

  it("write the cart badge and the toasts themselves, outside <main>", () => {
    for (const [page, html] of pages) {
      const outside = frame(html);
      expect(outside, page).toContain(`<djs-shop data-droplet="shopping-cart" data-droplet-props='{"variant":"badge"}'></djs-shop>`);
      expect(outside, page).toContain('<djs-shop data-droplet="toast-center"></djs-shop>');
    }
  });

  it("each have their path in nginx.conf", () => {
    const conf = read("nginx.conf");
    expect(conf).toContain("location = /gallery {\n    rewrite ^ /gallery.html last;");
    expect(conf).toContain('location ~ "^/product/[a-z0-9]+(?:-[a-z0-9]+)*$" {\n    rewrite ^ /product.html last;');
    expect(conf).toContain("location = /login {\n    rewrite ^ /login.html last;");
    expect(conf).toContain("location = /admin {\n    rewrite ^ /admin.html last;");
  });
});

describe("the htmx host's page of the Svelte droplets", () => {
  const html = read("html/index.html");

  it("loads that server's /index.js alone, cross-origin, and boosts nothing", () => {
    expect(html.match(/<script type="module" src="[^"]*"><\/script>/g)).toEqual([
      '<script type="module" src="http://localhost:8000/index.js"></script>',
    ]);
    expect(html).toContain(`<meta name="htmx-config" content='{"selfRequestsOnly": false}'>`);
    expect(html).toContain('<script src="/droplet-origins.js"></script>');
    expect(html).not.toContain("hx-boost");
  });
});
