import { createHash } from "node:crypto";
import { resolve, sep } from "node:path";
import { readFile } from "node:fs/promises";
import type { Handler } from "hono";

const CONTENT_TYPES = new Map([
  [".js", "application/javascript; charset=utf-8"],
  [".mjs", "application/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".avif", "image/avif"],
  [".ico", "image/x-icon"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".ttf", "font/ttf"],
  [".otf", "font/otf"],
]);

export type StaticHandlerOptions = {
  clientRoot: string;
  /** `Cache-Control` of `/assets/public/*`, `false` for none (`publicCacheControl`). Default: `no-cache`. */
  publicCacheControl?: string | false;
};

type ContentTypeOfInput = { path: string };

function contentTypeOf({ path }: ContentTypeOfInput): string {
  const dot = path.lastIndexOf(".");
  const ext = dot === -1 ? "" : path.slice(dot).toLowerCase();
  return CONTENT_TYPES.get(ext) ?? "application/octet-stream";
}

/**
 * Serves the shared chunks and assets Vite emits alongside the droplet
 * bundles, content-hashed and so cached for good, and the project's
 * `public/` under `/assets/public/`, whose names stay: `publicCacheControl`,
 * by default revalidated on every use (`no-cache`), with an `ETag` and 304
 * when it matches.
 */
export function createStaticHandler({ clientRoot, publicCacheControl = "no-cache" }: StaticHandlerOptions): Handler {
  const assetsRoot = resolve(clientRoot, "assets");
  const assetsPrefix = assetsRoot + sep;
  const publicPrefix = resolve(assetsRoot, "public") + sep;

  return async (c) => {
    const relativePath = c.req.path.replace(/^\/assets\//, "");
    const filePath = resolve(assetsRoot, relativePath);

    // The path comes from the URL and `resolve` has applied its `..`: outside the folder, read nothing.
    if (filePath !== assetsRoot && !filePath.startsWith(assetsPrefix)) {
      return c.text("Not Found", 404);
    }

    let body: Buffer;
    try {
      body = await readFile(filePath);
    } catch {
      // Missing, a directory or unreadable: a 404, never the error.
      return c.text("Not Found", 404);
    }
    c.header("content-type", contentTypeOf({ path: filePath }));
    c.header("x-content-type-options", "nosniff");
    if (!filePath.startsWith(publicPrefix)) {
      c.header("cache-control", "public, max-age=2592000, immutable");
      return c.body(new Uint8Array(body));
    }
    const etag = `"${createHash("sha1").update(body).digest("base64url")}"`;
    if (publicCacheControl !== false) c.header("cache-control", publicCacheControl);
    c.header("etag", etag);
    if (
      c.req
        .header("if-none-match")
        ?.split(",")
        .some((tag) => tag.trim() === etag)
    )
      return c.body(null, 304);
    return c.body(new Uint8Array(body));
  };
}
