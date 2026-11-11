/**
 * Every URL a droplet writes for its own files is on the droplet location,
 * where `/index.js` is served from, path prefix included, never a
 * root-relative `/assets/…`: the host page is on another origin, or behind
 * a proxy's prefix.
 *
 * - Browser bundles: relative to the file that names them, resolved at
 *   runtime against `import.meta.url` (JavaScript) or the stylesheet's own
 *   URL (CSS).
 * - Server bundles: the bundle's location token (`hostTokens`), which every
 *   fragment and its data have replaced with the request's location.
 * - `public/`: copied to `assets/public/` of the client build only.
 */
import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { cp, readFile, stat } from "node:fs/promises";
import { dirname, posix, resolve, sep } from "node:path";
import type { Context } from "hono";
import type { Plugin, UserConfig } from "vite";
import { hostTokens } from "../runtime/host.ts";
import { isServerPath, projectPath } from "./server-only.ts";
import type { PluginState } from "./state.ts";

/** Where `public/` is served from, in a build and in `vite dev`. */
export const PUBLIC_PATH = "assets/public";

/** Replaced in each browser bundle with the way from that file to the build's root (see `serverLocation`). */
const BUILD_ROOT = "__DROPLETS_BUILD_ROOT__";
const BUILD_ROOT_LITERAL = new RegExp(`(["'\`])${BUILD_ROOT}\\1`, "g");

/**
 * What a server bundle's file URLs start with until its chunks are
 * rendered, then the location token of the instance shared by every
 * environment: `renderBuiltUrl` lives in a config that `vite build`
 * resolves again per environment, with a nonce of its own.
 */
const SERVER_LOCATION = "__DROPLETS_SERVER_LOCATION__";

type RenderBuiltUrl = NonNullable<NonNullable<UserConfig["experimental"]>["renderBuiltUrl"]>;

/** What Vite tells `renderBuiltUrl` about the file that names a URL; Vite does not export it. */
export type BuiltUrlContext = Parameters<RenderBuiltUrl>[1];

/** What `builtUrl` needs: the user's own `renderBuiltUrl`, which goes first. */
export type BuiltUrlInput = { user: RenderBuiltUrl | undefined };

/** `experimental.renderBuiltUrl`: see the module comment. */
export function builtUrl({ user }: BuiltUrlInput): RenderBuiltUrl {
  return (filename, context) => {
    const own = user?.(filename, context);
    if (own !== undefined) return own;
    const file = context.type === "public" ? `${PUBLIC_PATH}/${filename}` : filename;
    if (context.ssr) return `${SERVER_LOCATION}/${file}`;
    if (context.type === "asset") return { relative: true };
    // Stylesheets are named from `assetFileNames`, under `assets/`, while
    // `hostId` is the name before that.
    const host = context.hostType === "css" ? posix.join("assets", context.hostId) : context.hostId;
    const relative = posix.relative(posix.dirname(host), file);
    if (context.hostType === "js") return { runtime: `new URL(${JSON.stringify(relative)}, import.meta.url).href` };
    return relative.startsWith(".") ? relative : `./${relative}`;
  };
}

/** What a browser bundle at `fileName` writes for `BUILD_ROOT`: `../../` from `droplets/<id>/client.js`. */
type RootFromInput = { fileName: string };

function rootFrom({ fileName }: RootFromInput): string {
  const up = posix.relative(posix.dirname(fileName), "");
  return up ? `${up}/` : "./";
}

/**
 * `new URL("./logo.png", import.meta.url)` in a server bundle would name a
 * file on the server's disk (Node) or no URL at all (Workers). In the
 * project's universal files (not server files, which may read their own
 * files that way) it becomes the file's built URL, as in the browser.
 */
const FILE_URL = /\bnew\s+URL\s*\(\s*(["'`])(\.{1,2}\/[^"'`$\n]+)\1\s*,\s*import\.meta\.url\s*\)/g;

/** What `rewriteFileUrls` reads: the module's code and file, and the token to fall back on. */
export type FileUrlsInput = { code: string; file: string; location: string };

/** The code with each `new URL("./x", import.meta.url)` of an existing file imported as `?url`; `null` when there is none. */
export function rewriteFileUrls({ code, file, location }: FileUrlsInput): string | null {
  const imports: string[] = [];
  const rewritten = code.replace(FILE_URL, (match, _quote: string, specifier: string) => {
    const target = resolve(dirname(file), specifier.replace(/[?#].*$/, ""));
    if (!existsSync(target) || !statSync(target).isFile()) return match;
    const name = `__droplets_file_${imports.length}`;
    const query = specifier.includes("?") ? "&url" : "?url";
    imports.push(`import ${name} from ${JSON.stringify(`${specifier}${query}`)};`);
    return `new URL(${name}, ${JSON.stringify(`${location}/`)})`;
  });
  return imports.length ? `${imports.join("\n")}\n${rewritten}` : null;
}

/** Copies `public/` into the client build's `assets/public/`; nothing else gets a copy. */
export async function copyPublicDir(state: PluginState): Promise<void> {
  if (!state.publicDir || !existsSync(state.publicDir)) return;
  await cp(state.publicDir, resolve(state.outDir, "client", PUBLIC_PATH), { recursive: true });
}

/** What `publicFileHandler` serves: the project's `public/` directory. */
export type PublicFilesInput = { publicDir: string };

/**
 * `/assets/public/*` under `vite dev`, as the adapters serve it in a build:
 * the file, `no-cache` with an `ETag`, 304 when it matches.
 */
export function publicFileHandler({ publicDir }: PublicFilesInput): (c: Context) => Promise<Response> {
  const root = resolve(publicDir);
  return async (c: Context): Promise<Response> => {
    const file = resolve(root, c.req.path.slice(`/${PUBLIC_PATH}/`.length));
    if (!file.startsWith(root + sep)) return c.text("Not Found", 404);
    let body: Buffer;
    try {
      if (!(await stat(file)).isFile()) return c.text("Not Found", 404);
      body = await readFile(file);
    } catch {
      // Gone between the stat and the read, or unreadable: not a file the browser gets.
      return c.text("Not Found", 404);
    }
    const etag = `"${createHash("sha1").update(body).digest("base64url")}"`;
    c.header("cache-control", "no-cache");
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

/** The plugin that puts browser bundles' and server bundles' file URLs on the droplet location. */
export function assetUrlsPlugin(state: PluginState): Plugin {
  let serving = false;
  return {
    name: "droplets:asset-urls",
    enforce: "post",
    // One instance, one nonce, for every environment of a build.
    sharedDuringBuild: true,
    configResolved(config) {
      serving = config.command === "serve";
    },
    transform(code, id) {
      const consumer = this.environment.config.consumer;
      if (consumer === "client") {
        if (!serving || !code.includes(BUILD_ROOT)) return null;
        return { code: code.replace(BUILD_ROOT_LITERAL, '"/"'), map: null };
      }
      if (!code.includes("import.meta.url")) return null;
      const rel = projectPath({ root: state.root, id });
      if (rel === null || isServerPath({ path: rel })) return null;
      const rewritten = rewriteFileUrls({
        code,
        file: id.replace(/[?#].*$/, ""),
        location: hostTokens({ nonce: state.tokenNonce }).location,
      });
      return rewritten === null ? null : { code: rewritten, map: null };
    },
    renderChunk(code, chunk) {
      if (this.environment.config.consumer !== "client") {
        if (!code.includes(SERVER_LOCATION)) return null;
        return { code: code.replaceAll(SERVER_LOCATION, hostTokens({ nonce: state.tokenNonce }).location), map: null };
      }
      if (!code.includes(BUILD_ROOT)) return null;
      return { code: code.replace(BUILD_ROOT_LITERAL, JSON.stringify(rootFrom({ fileName: chunk.fileName }))), map: null };
    },
  };
}
