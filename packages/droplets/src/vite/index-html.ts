import { resolve } from "node:path";
import { loadTextFile } from "../core/fs.ts";

/** What `/` serves when the project has no `index.html` of its own. */
export const DEFAULT_INDEX_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Droplets</title>
<style>
  :root { color-scheme: light dark; --fg: #1c1f24; --bg: #fafaf9; --muted: #6b7079; }
  @media (prefers-color-scheme: dark) { :root { --fg: #e8eaed; --bg: #121418; --muted: #9aa0a8; } }
  html, body { height: 100%; margin: 0; }
  body {
    display: grid; place-items: center; background: var(--bg); color: var(--fg);
    font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; padding: 0 16px;
  }
  p { margin: 0; text-align: center; }
  span { color: var(--muted); }
</style>
</head>
<body>
<p>Powering Microfrontends with <strong>DropletsJS</strong><br><span>This server answers droplets under /droplets/.</span></p>
</body>
</html>
`;

/**
 * The HTML for `/` under `index`: the named file, else `index.html` in the
 * root, else the placeholder. `false` means no page at all (`null`).
 */
type LoadIndexHtmlInput = { root: string; index: string | false | undefined };

export async function loadIndexHtml({ root, index }: LoadIndexHtmlInput): Promise<string | null> {
  if (index === false) return null;
  if (typeof index === "string") {
    const html = await loadTextFile({ path: resolve(root, index) });
    if (html === null) {
      throw new Error(`droplets: index points at ${index}, which does not exist`);
    }
    return html;
  }
  return (await loadTextFile({ path: resolve(root, "index.html") })) ?? DEFAULT_INDEX_HTML;
}
