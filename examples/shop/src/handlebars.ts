// Handlebars helpers: every export is one, registered in the renderer's own
// environment. product-page is the only Handlebars droplet.
import { imageUrl as urlOf } from "./lib/api.ts";
import { liveToken, versionToken } from "./lib/live.ts";

/** `{{live "stock-label"}}`: a placeholder `transform` fills per request (see lib/live.ts). */
export const live = (name: unknown) => liveToken(String(name));

/** `{{productHref slug}}`: the product page's path, its current `?v=` filled in by `transform`. */
export const productHref = (slug: unknown) => `/product/${String(slug)}${versionToken(String(slug))}`;

/** `{{imageUrl data.product.image}}`: the image's URL on the droplets server. */
export const imageUrl = (key: unknown) => urlOf(String(key));

/** `{{#each (paragraphs text)}}`: a text's paragraphs, split on blank lines. */
export const paragraphs = (text: unknown) =>
  String(text ?? "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
