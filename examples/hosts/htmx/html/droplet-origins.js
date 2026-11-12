// htmx 2 talks to the page's own origin only (`selfRequestsOnly`), and that
// check runs before `htmx:validateUrl` fires, so the pages turn it off and
// this listener takes its place: a request may go to this origin, or to an
// origin the page loads an /index.js from (a droplets server). Any other is
// refused, with `htmx:invalidPath` as htmx's own refusal.
const origins = new Set(
  Array.from(document.querySelectorAll('script[type="module"][src]'))
    .map((script) => new URL(script.src))
    .filter((url) => url.pathname.endsWith("/index.js"))
    .map((url) => url.origin),
);

document.addEventListener("htmx:validateUrl", (event) => {
  const { url, sameHost } = event.detail;
  if (!sameHost && !origins.has(url.origin)) event.preventDefault();
});
