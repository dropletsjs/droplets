import { resolve, sep } from "node:path";
import { readFile } from "node:fs/promises";
import type { Context } from "hono";

const CONTENT_TYPES: Record<string, string> = {
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

function contentTypeFor(path: string): string {
  const dot = path.lastIndexOf(".");
  const ext = dot === -1 ? "" : path.slice(dot).toLowerCase();
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

/**
 * Serves the shared chunks and assets Vite emits alongside the droplet
 * bundles. Everything here is content-hashed, hence the immutable caching.
 */
export function createStaticHandler(clientRoot: string) {
  const assetsRoot = resolve(clientRoot, "assets");
  const assetsPrefix = assetsRoot + sep;

  return async (c: Context): Promise<Response> => {
    const relativePath = c.req.path.replace(/^\/assets\//, "");
    const filePath = resolve(assetsRoot, relativePath);

    // Reject anything that escapes the assets directory.
    if (filePath !== assetsRoot && !filePath.startsWith(assetsPrefix)) {
      return c.text("Not Found", 404);
    }

    try {
      const body = await readFile(filePath);
      c.header("content-type", contentTypeFor(filePath));
      c.header("cache-control", "public, max-age=2592000, immutable");
      return c.body(new Uint8Array(body));
    } catch {
      return c.text("Not Found", 404);
    }
  };
}
