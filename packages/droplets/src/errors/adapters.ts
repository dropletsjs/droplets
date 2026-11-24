/**
 * The messages of the adapter packages (`@dropletsjs/adapter-*`), at build
 * and at runtime.
 *
 * @module
 */
import type { AnyMessage, ErrorPages } from "./format.ts";

export const CLOUDFLARE_HEADERS_OVER_LIMITS = {
  code: "cloudflare-headers-over-limits",
  level: "warning",
  what: ({ over, rules, line }: { over: string; rules: number; line: number; file: string }) =>
    `dist/client/_headers has ${over}: Cloudflare takes up to ${rules} rules and ${line} characters per line`,
  fix: ({ file }: { over: string; rules: number; line: number; file: string }) => `trim ${file}`,
} satisfies AnyMessage;

export const CLOUDFLARE_PUBLIC_HEADERS_IGNORED = {
  code: "cloudflare-public-headers-ignored",
  level: "warning",
  what: "public/_headers lands at /assets/public/_headers, where Cloudflare never reads it",
  fix: ({ file }: { file: string }) => `move your rules to ${file} in the project root, which the adapter appends to dist/client/_headers`,
} satisfies AnyMessage;

export const CLOUDFLARE_WRANGLER_UNREADABLE = {
  code: "cloudflare-wrangler-unreadable",
  level: "warning",
  what: "could not read the wrangler config (assets.run_worker_first, compatibility_flags)",
  fix: 'leave run_worker_first out so static assets serve the build\'s files with dist/client/_headers, and set compatibility_flags to ["nodejs_compat"]',
} satisfies AnyMessage;

export const CLOUDFLARE_NODEJS_COMPAT_MISSING = {
  code: "cloudflare-nodejs-compat-missing",
  level: "warning",
  what: 'compatibility_flags has no "nodejs_compat", so the Worker has no AsyncLocalStorage and requests that overlap share one request store',
  fix: 'set "compatibility_flags": ["nodejs_compat"] in the wrangler config',
} satisfies AnyMessage;

export const CLOUDFLARE_HTML_HANDLING_NONE = {
  code: "cloudflare-html-handling-none",
  level: "warning",
  what: ({ files }: { files: string }) => `assets.html_handling is "none", so ${files} answers 404 (only <file>.html is served)`,
  fix: "leave html_handling out of the wrangler config",
} satisfies AnyMessage;

export const CLOUDFLARE_HTML_HANDLING_TRAILING_SLASH = {
  code: "cloudflare-html-handling-trailing-slash",
  level: "warning",
  what: ({ files }: { files: string }) => `assets.html_handling is "force-trailing-slash", so ${files} redirects to ${files}/`,
  fix: "leave html_handling out of the wrangler config",
} satisfies AnyMessage;

export const CLOUDFLARE_RUN_WORKER_FIRST = {
  code: "cloudflare-run-worker-first",
  level: "warning",
  what: ({ value, shown }: { value: string; shown: string }) =>
    `assets.run_worker_first is ${value}, so build files (${shown}) go through the Worker, billed per request`,
  fix: "leave run_worker_first out: dist/client/_headers already gives the build files their CORS and cache headers",
} satisfies AnyMessage;

export const CLOUDFLARE_ASSETS_BINDING_MISSING = {
  code: "cloudflare-assets-binding-missing",
  level: "error",
  what: ({ binding }: { binding: string }) => `the Worker has no "${binding}" binding`,
  fix: "add assets.directory and assets.binding to the wrangler config",
} satisfies AnyMessage;

export const MANIFEST_NOT_FOUND = {
  code: "manifest-not-found",
  level: "error",
  what: ({ path }: { path: string }) => `droplets.json not found at ${path}`,
  fix: "run vite build before starting the server, and start it from the build's output folder",
} satisfies AnyMessage;

export const MANIFEST_MALFORMED = {
  code: "manifest-malformed",
  level: "error",
  what: ({ path, reason }: { path: string; reason: string }) => `${path} is not valid JSON: ${reason}`,
  fix: "let vite build finish, or build again: the file was written in part",
} satisfies AnyMessage;

export const ADAPTERS_PAGES: ErrorPages = {
  "cloudflare-headers-over-limits": {
    when: "vite build with the Cloudflare adapter, when the generated dist/client/_headers is over Cloudflare's limits.",
    see: "/guides/deployment/#static-files-and-_headers",
  },
  "cloudflare-public-headers-ignored": {
    when: "vite build with the Cloudflare adapter, when the project has public/_headers.",
    see: "/guides/deployment/#static-files-and-_headers",
  },
  "cloudflare-wrangler-unreadable": {
    when: "vite build with the Cloudflare adapter, when the wrangler config is text the adapter does not parse; the build goes on.",
    see: "/guides/deployment/#cloudflare-workers",
  },
  "cloudflare-nodejs-compat-missing": {
    when: 'vite build with the Cloudflare adapter, when the wrangler config\'s compatibility_flags lack "nodejs_compat".',
    see: "/guides/deployment/#cloudflare-workers",
  },
  "cloudflare-html-handling-none": {
    when: 'vite build with the Cloudflare adapter, when the build writes prerender files and the wrangler config sets assets.html_handling to "none".',
    see: "/guides/prerendering/#static-files",
  },
  "cloudflare-html-handling-trailing-slash": {
    when: 'vite build with the Cloudflare adapter, when the build writes prerender files and the wrangler config sets assets.html_handling to "force-trailing-slash".',
    see: "/guides/prerendering/#static-files",
  },
  "cloudflare-run-worker-first": {
    when: "vite build with the Cloudflare adapter, when assets.run_worker_first in the wrangler config matches the build's files.",
    see: "/guides/deployment/#run_worker_first",
  },
  "cloudflare-assets-binding-missing": {
    when: "In the Cloudflare Worker, on a request, when the assets binding the build expects is not in the Worker's environment.",
    see: "/guides/deployment/#cloudflare-workers",
  },
  "manifest-not-found": {
    when: "In the production server on Node, Bun or Deno, when dist/client/droplets.json is missing; logged once until it appears.",
    see: "/guides/deployment/",
  },
  "manifest-malformed": {
    when: "In the production server on Node, Bun or Deno, when dist/client/droplets.json does not parse; logged once until it does.",
    see: "/guides/deployment/",
  },
};
