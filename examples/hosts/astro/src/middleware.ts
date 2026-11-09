import { defineMiddleware } from "astro:middleware";

/**
 * Astro's own cross-site form check (`security.checkOrigin`), against this
 * host's public origin read at runtime. Astro's check compares `Origin` with
 * the request's URL, whose host it trusts only when `security.allowedDomains`
 * lists it, and that list is fixed at build. Here `SHOP_PUBLIC_URL` comes
 * from the container's environment, so one image runs under any origin;
 * astro.config.mjs turns the built-in check off.
 */
const origin = new URL(process.env.SHOP_PUBLIC_URL ?? "http://localhost:8005").origin;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const FORM_CONTENT_TYPES = ["application/x-www-form-urlencoded", "multipart/form-data", "text/plain"];

export const onRequest = defineMiddleware((context, next) => {
  const { request, isPrerendered } = context;
  if (isPrerendered || SAFE_METHODS.has(request.method)) return next();
  const type = request.headers.get("content-type")?.toLowerCase();
  // As Astro does: a form-like body, or no content type at all, must come from this origin.
  const formLike = type === undefined || FORM_CONTENT_TYPES.some((form) => type.includes(form));
  if (formLike && request.headers.get("origin") !== origin) {
    return new Response(`Cross-site ${request.method} form submissions are forbidden`, { status: 403 });
  }
  return next();
});
