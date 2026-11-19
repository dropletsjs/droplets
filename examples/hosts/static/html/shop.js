// The shop's pages, composed in the browser from fragments the shop's
// droplets server answers on its own origin. nginx gives every shop path
// this one page; the path says which droplets it asks for.
//
// Every request to the shop carries its cookies (the cart, the admin
// session): the shop answers this page's origin with credentials, and
// the element's own requests include them too.

// The droplets server is wherever the page loads /index.js from: one URL to
// change when it moves.
const entry = [...document.querySelectorAll('script[type="module"][src]')]
  .map((script) => new URL(script.src))
  .find((url) => url.pathname.endsWith("/index.js"));
const DROPLETS = new URL(".", entry).href;

const STACK = "a static page";
const main = document.getElementById("page");

/**
 * `GET <droplets>/droplets/<id>?<params>`, inserted into `target` when the
 * answer is a fragment: a 2xx, or a 500 or 504 carrying the droplet's error
 * page. Any other answer may echo the props, so it is never inserted; a redirect
 * is never followed (its target is opaque here) and goes to `onRedirect`.
 */
async function fragment({ id, params, target, onRedirect }) {
  target.replaceChildren(note("shop-loading", "Loading…"));
  try {
    const response = await fetch(new URL(`droplets/${encodeURIComponent(id)}?${params}`, DROPLETS), {
      redirect: "manual",
      headers: { accept: "text/html" },
      credentials: "include",
      // The page's whole URL, not only its origin: the shop takes the host
      // page from Referer, where a form's result comes back to.
      referrerPolicy: "no-referrer-when-downgrade",
    });
    if (response.type === "opaqueredirect" && onRedirect) return onRedirect();
    const isFragment =
      (response.ok || [500, 504].includes(response.status)) && (response.headers.get("content-type") ?? "").startsWith("text/html");
    if (!isFragment) throw new Error(`HTTP ${response.status}`);
    const template = document.createElement("template");
    template.innerHTML = await response.text();
    // The element upgrades as it enters the document: /index.js defined it.
    target.replaceChildren(template.content);
  } catch {
    target.replaceChildren(note("shop-unavailable", "This droplet is unavailable."));
  }
}

function note(className, text) {
  const p = document.createElement("p");
  p.className = className;
  p.textContent = text;
  return p;
}

function element(tag, attributes = {}, children = []) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  node.append(...children);
  return node;
}

/** The query parameters of `query` named in `names`. */
function pick(query, names) {
  const picked = new URLSearchParams();
  for (const name of names) for (const value of query.getAll(name)) picked.append(name, value);
  return picked;
}

function current(href) {
  document.querySelector(`.shop-nav a[href="${href}"]`).setAttribute("aria-current", "page");
}

function gallery(query) {
  document.title = `Gallery · Droplets Shop on ${STACK}`;
  current("/gallery");
  const filter = element("aside");
  const library = element("div");
  main.append(
    element("section", { class: "shop-hero" }, [
      element("h1", {}, ["Everything a demo shop needs."]),
      element("p", {}, ["Rendered by six frameworks, embedded by one static HTML page."]),
    ]),
    element("div", { class: "shop-gallery" }, [filter, library]),
  );
  // The whole query to both: the shop drops what a droplet does not take.
  fragment({ id: "product-filter", params: query, target: filter });
  fragment({ id: "product-library", params: query, target: library });
}

/** A product's id, name and category, from the product page's public `_data` read; `null` when unknown. */
async function productOf(slug) {
  const response = await fetch(new URL(`droplets/product-page/_data?${new URLSearchParams({ slug })}`, DROPLETS), {
    redirect: "manual",
    headers: { accept: "application/json" },
    credentials: "include",
  });
  if (!response.ok) return null;
  const product = (await response.json())?.data?.product;
  return typeof product?.id === "string" && typeof product.name === "string" ? product : null;
}

async function product(slug, query) {
  const found = await productOf(slug).catch(() => null);
  if (!found) {
    document.title = `Not found · Droplets Shop on ${STACK}`;
    main.append(
      element("div", { class: "shop-narrow shop-notice" }, [
        element("h1", {}, ["Not found"]),
        element("p", {}, ["This product does not exist."]),
        element("p", {}, [element("a", { href: "/gallery" }, ["Back to the gallery"])]),
      ]),
    );
    return;
  }
  document.title = `${found.name} · Droplets Shop on ${STACK}`;
  const category = found.category ?? {};
  const page = element("div", { id: "product" });
  const comments = element("section", { id: "comments", class: "shop-comments" });
  main.append(
    element("nav", { class: "shop-crumbs", "aria-label": "Breadcrumb" }, [
      element("a", { href: "/gallery" }, ["Gallery"]),
      " › ",
      element("a", { href: `/gallery?${new URLSearchParams({ category: String(category.slug ?? "") })}` }, [String(category.name ?? "")]),
      " › ",
      element("span", { "aria-current": "page" }, [found.name]),
    ]),
    page,
    comments,
  );

  // `v`, when the link had one: the shop serves its build's page for the
  // current version and redirects an old one, here to this URL without it.
  const props = pick(query, ["v"]);
  props.set("slug", slug);
  fragment({
    id: "product-page",
    params: props,
    target: page,
    onRedirect() {
      const rest = new URLSearchParams(query);
      rest.delete("v");
      history.replaceState(null, "", `/product/${encodeURIComponent(slug)}${rest.size ? `?${rest}` : ""}`);
      fragment({ id: "product-page", params: new URLSearchParams({ slug }), target: page });
    },
  });
  const commentProps = pick(query, ["order", "page", "showing"]);
  commentProps.set("productId", found.id);
  fragment({ id: "product-comments", params: commentProps, target: comments });
}

/** The admin: its `view` and `id`; the gate and its login link without a session. */
function admin(query) {
  document.title = `Admin · Droplets Shop on ${STACK}`;
  current("/admin");
  const target = element("div");
  main.append(target);
  fragment({ id: "product-admin", params: pick(query, ["view", "id"]), target });
}

/** The shop's login: `next`, where its redirect goes once logged in. */
function login(query) {
  document.title = `Log in · Droplets Shop on ${STACK}`;
  const target = element("div", { class: "shop-narrow" });
  main.append(target);
  fragment({ id: "login", params: pick(query, ["next"]), target });
}

const query = new URLSearchParams(location.search);
const slug = /^\/product\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(location.pathname)?.[1];
if (location.pathname === "/gallery") gallery(query);
else if (location.pathname === "/admin") admin(query);
else if (location.pathname === "/login") login(query);
else if (slug) product(slug, query);
