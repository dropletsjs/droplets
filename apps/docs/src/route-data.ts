import { defineRouteMiddleware } from "@astrojs/starlight/route-data";
import { twinHref } from "./plugins/markdown-twin.mjs";

/** Every docs page names its Markdown twin; Starlight's 404 page has none. */
export const onRequest = defineRouteMiddleware(({ locals }) => {
  const route = locals.starlightRoute;
  if (route.id === "404") return;
  route.head.push({
    tag: "link",
    attrs: { rel: "alternate", type: "text/markdown", href: twinHref(route.id, import.meta.env.BASE_URL) },
  });
});
