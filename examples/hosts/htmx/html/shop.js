// The shop's pages are static files: what a host's server would do with the
// page's URL happens here, around htmx.

// A droplet's props from the page's URL, as a server would forward them:
// `data-page-query` lists the query parameters it takes, `data-page-slug`
// names the prop that takes the path's last segment (/product/<slug>).
document.addEventListener("htmx:configRequest", (event) => {
  const source = event.detail.elt;
  const page = new URL(location.href);
  const names = (source.getAttribute("data-page-query") ?? "").split(" ").filter(Boolean);
  for (const name of names) {
    if (page.searchParams.has(name)) event.detail.parameters[name] = page.searchParams.get(name);
  }
  const slug = source.getAttribute("data-page-slug");
  if (slug) event.detail.parameters[slug] = page.pathname.split("/").pop();
});

// Links in <main> go by htmx as the header's do: htmx boosts the links it
// sees when it swaps, and a droplet renders its own links after that.
document.addEventListener("click", (event) => {
  const link = event.target instanceof Element ? event.target.closest("main a[href]") : null;
  if (!link || event.defaultPrevented || event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  if (link.origin !== location.origin || link.target || link.hasAttribute("download")) return;
  if (link.getAttribute("hx-boost") === "false" || /^\/(droplets|api|assets)\//.test(link.pathname)) return;
  if (link.hash && link.pathname === location.pathname && link.search === location.search) return;
  event.preventDefault();
  // From the body: its hx-target, hx-select and hx-swap, as a boosted link.
  htmx.ajax("get", link.href, { source: document.body, push: "true" });
});

// htmx swaps a 2xx only. A droplet that answers an error gets a note in its
// place (the answer may echo the query); a page that does loads in full.
document.addEventListener("htmx:responseError", (event) => {
  const { target, pathInfo } = event.detail;
  if (target.matches("main")) location.assign(pathInfo.requestPath);
  else target.innerHTML = '<p class="shop-unavailable">This droplet is unavailable.</p>';
});

// The header stays across navigations, so its current link follows the page.
function markCurrent() {
  for (const link of document.querySelectorAll(".shop-nav a")) {
    if (link.pathname === location.pathname) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
}
document.addEventListener("htmx:pushedIntoHistory", markCurrent);
document.addEventListener("htmx:historyRestore", markCurrent);
