/**
 * The pages allowed to embed the demo's droplets and post to them: the docs
 * site, and the docs on their local dev and preview servers. Nothing else:
 * no `*`, no pattern. Exact origins, compared as such.
 */
export const DOCS_ORIGINS = [
  "https://dropletsjs.dev",
  "http://localhost:4321",
  "http://127.0.0.1:4321",
] as const;
