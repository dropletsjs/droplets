/**
 * The messages of `@dropletsjs/devtools`.
 *
 * @module
 */
import type { AnyMessage, ErrorPages } from "./format.ts";

export const DEVTOOLS_WITHOUT_DROPLETS = {
  code: "devtools-without-droplets",
  level: "error",
  what: "dropletsDevtools() is in the Vite config without droplets()",
  fix: "add droplets() from @dropletsjs/droplets/vite to the plugins too",
} satisfies AnyMessage;

export const DEVTOOLS_PAGE_ELEMENT_MISSING = {
  code: "devtools-page-element-missing",
  level: "error",
  what: ({ id }: { id: string }) => `the devtools page has no #${id}`,
  fix: "reload the page; the devtools page script runs only on the page the devtools serve at /",
} satisfies AnyMessage;

export const DEVTOOLS_PAGES: ErrorPages = {
  "devtools-without-droplets": {
    when: "vite dev or vite build, when the Vite config has dropletsDevtools() but not droplets().",
    see: "/guides/development/#the-devtools-page",
  },
  "devtools-page-element-missing": {
    when: "In the browser, on the devtools page under vite dev, when its script finds the page without an element it fills.",
    see: "/guides/development/#the-devtools-page",
  },
};
