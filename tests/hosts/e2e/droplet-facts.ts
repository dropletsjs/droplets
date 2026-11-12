import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";

/**
 * What the droplet tour's caption says about each droplet on a page, and
 * where each fact comes from. Only what droplets itself exposes: nothing
 * here is a table of the shop's droplets.
 *
 * - name: the element's `data-droplet`.
 * - framework: the renderer `djs sync` names for the droplet, in the header
 *   of its generated `./$types` (`// src/droplets/login/ (hono-jsx)`). The
 *   running server exposes no framework.
 * - SSR: whether the element came with server markup, which carries a
 *   `data-droplet-render`; a client-only droplet has none.
 * - prerendered or live: the page fetched again. A stored (build-time)
 *   render keeps its `data-droplet-render`; a live render draws a new one each
 *   time. No header says so.
 * - hydrate: the element's `data-droplet-hydrate` (the host's choice), else the
 *   droplet's flag in the server's `/index.js` (its hydration map); a
 *   droplet absent from it ships no JavaScript.
 * - actions: the server's answer to a form post naming an action that
 *   cannot exist (`?/__tour`, no body): 404 "No action named …" when the
 *   droplet has actions, 405 "… has no form actions" when it has none. The
 *   action is looked up before any body is read, so nothing runs and
 *   nothing changes.
 */
export type DropletFacts = {
  droplet: string;
  framework: string;
  ssr: string;
  render: string;
  hydrate: string;
  actions: string;
};

const EXAMPLES = join(import.meta.dirname, "..", "..", "..", "examples");

/**
 * The shop's source the host serves, for `djs sync`: examples/shop, or on
 * the WordPress showcase examples/wp-shop (the same droplets, WordPress's data).
 */
export const shopSource = (host: string) => join(EXAMPLES, host.startsWith("wordpress") ? "wp-shop" : "shop");

const RENDERER_NAMES: Record<string, string> = {
  svelte: "Svelte",
  vue: "Vue",
  react: "React",
  solid: "Solid",
  "hono-jsx": "Hono JSX",
  handlebars: "Handlebars",
};

/**
 * Droplet id → its renderer, as `djs sync` writes it into each droplet's
 * `./$types` header. Empty when the sync fails.
 */
export function renderersFromSync(source: string): Map<string, string> {
  const found = new Map<string, string>();
  const synced = spawnSync("pnpm", ["exec", "djs", "sync"], { cwd: source, encoding: "utf8" });
  if (synced.status !== 0) {
    console.warn(`djs sync failed: ${synced.stderr || synced.error}`);
    return found;
  }
  const root = join(source, ".droplets", "types", "src", "droplets");
  for (const folder of readdirSync(root)) {
    let header = "";
    try {
      header = readFileSync(join(root, folder, "$types.d.ts"), "utf8")
        .split("\n")
        .slice(0, 3)
        .join("\n");
    } catch {
      continue;
    }
    const match = /^\/\/ \S*\/([^/\s]+)\/ \(([^)]+)\)$/m.exec(header);
    if (!match) continue;
    found.set(match[1]!, match[2]!);
  }
  return found;
}

type OnPage = {
  element: string;
  origin: string;
  droplets: { droplet: string; renderId: string | null; hydrateAttr: string | null }[];
};

/** The droplets server on the page (from what its `/index.js` wrote) and its elements, in document order. */
async function onPage(page: Page): Promise<OnPage | null> {
  return page.evaluate(() => {
    const servers = (globalThis as unknown as Record<symbol, Record<string, { origin?: string }> | undefined>)[
      Symbol.for("droplets.servers")
    ];
    const [key, record] = Object.entries(servers ?? {})[0] ?? [];
    if (!key || !record?.origin) return null;
    const element = key.slice(0, key.lastIndexOf(":"));
    const droplets = [...document.querySelectorAll<HTMLElement>(`${element}[data-droplet]`)].map((node) => ({
      droplet: node.dataset["droplet"] ?? "",
      renderId: node.getAttribute("data-droplet-render"),
      hydrateAttr: node.getAttribute("data-droplet-hydrate"),
    }));
    return { element, origin: record.origin, droplets };
  });
}

type HydrateMode = boolean | "visible" | "interactive";

/**
 * The hydration map in the server's `/index.js`: the object right after
 * the one listing every droplet (`dropletsById`, then
 * `dropletsHydrateById`), minified or not.
 */
async function hydrationMap(page: Page, origin: string, ids: string[]): Promise<Map<string, HydrateMode> | null> {
  const stub = await (await page.request.get(`${origin}/index.js`)).text();
  const entry = /import\(\s*["'`]([^"'`]+)["'`]\s*\)/.exec(stub)?.[1];
  const code = entry ? await (await page.request.get(new URL(entry, `${origin}/index.js`).href)).text() : stub;
  const value = String.raw`(?:!0|!1|true|false|"[a-z]+"|'[a-z]+'|\x60[a-z]+\x60)`;
  // A key is quoted, or bare when it is an identifier (`login`, once minified).
  const key = `(?:"[a-z0-9-]+"|[a-z][a-z0-9]*)`;
  const objects = [...code.matchAll(new RegExp(String.raw`\{\s*((?:${key}\s*:\s*${value}\s*,?\s*)*)\}`, "g"))];
  const parse = (body: string) =>
    new Map(
      [...body.matchAll(new RegExp(String.raw`"?([a-z0-9-]+)"?\s*:\s*(${value})`, "g"))].map(([, id, raw]) => {
        const text = raw!.replace(/^["'`]|["'`]$/g, "");
        const mode: HydrateMode =
          text === "!0" || text === "true" ? true : text === "!1" || text === "false" ? false : (text as HydrateMode);
        return [id!, mode] as const;
      }),
    );
  for (let i = 0; i < objects.length - 1; i++) {
    const all = parse(objects[i]![1]!);
    if (!ids.every((id) => all.get(id) === true)) continue;
    const next = objects[i + 1]!;
    const gap = code.slice(objects[i]!.index! + objects[i]![0].length, next.index);
    if (!/^[\s,;]*(?:export\s+)?(?:const\s+|let\s+|var\s+)?[\w$]+\s*=\s*$/.test(gap)) continue;
    return parse(next[1]!);
  }
  return null;
}

const HYDRATE_LABELS: Record<string, string> = {
  true: "at once",
  visible: "when visible",
  interactive: "on first interaction",
  false: "never (no JavaScript)",
};

/** Each droplet element on the page, in document order, with what droplets says about it. */
export async function readFacts(page: Page, renderers: Map<string, string>): Promise<{ element: string; droplets: DropletFacts[] }> {
  const seen = await onPage(page);
  if (!seen) throw new Error("no droplets server on this page (its /index.js did not run)");
  const ids = [...new Set(seen.droplets.map((d) => d.droplet))];

  // The same page again, with the same cookies: which render ids came back.
  const again = await (await page.request.get(page.url())).text();
  const renderIds = new Map<string, (string | null)[]>();
  for (const [tag] of again.matchAll(new RegExp(`<${seen.element}\\b[^>]*>`, "g"))) {
    const droplet = /\sdata-droplet="([^"]*)"/.exec(tag)?.[1];
    if (!droplet) continue;
    const list = renderIds.get(droplet) ?? [];
    list.push(/\sdata-droplet-render="([^"]*)"/.exec(tag)?.[1] ?? null);
    renderIds.set(droplet, list);
  }

  const hydration = await hydrationMap(page, seen.origin, ids);

  const actions = new Map<string, string>();
  for (const id of ids) {
    const answer = await page.request.post(`${seen.origin}/droplets/${encodeURIComponent(id)}?/__tour`, {
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
        origin: new URL(page.url()).origin,
      },
      data: "",
      maxRedirects: 0,
    });
    const text = await answer.text();
    actions.set(
      id,
      answer.status() === 404 && text.startsWith("No action named")
        ? "yes"
        : answer.status() === 405
          ? "none"
          : `unknown (HTTP ${answer.status()})`,
    );
  }

  const index = new Map<string, number>();
  const droplets = seen.droplets.map(({ droplet, renderId, hydrateAttr }) => {
    const nth = index.get(droplet) ?? 0;
    index.set(droplet, nth + 1);
    const later = renderIds.get(droplet)?.[nth];
    const renderer = renderers.get(droplet);
    const flag = hydration ? (hydration.get(droplet) ?? false) : undefined;
    const asked =
      hydrateAttr === null
        ? undefined
        : hydrateAttr === "" || hydrateAttr === "true"
          ? true
          : hydrateAttr === "false"
            ? false
            : hydrateAttr;
    const mode = asked ?? flag;
    return {
      droplet,
      framework: renderer ? (RENDERER_NAMES[renderer] ?? renderer) : "not exposed",
      ssr: renderId ? "on" : "off",
      render: !renderId
        ? "in the browser"
        : later === undefined
          ? "unknown"
          : later === renderId
            ? "prerendered at build"
            : "live, for this request",
      hydrate:
        mode === undefined
          ? "unknown"
          : `${HYDRATE_LABELS[String(mode)] ?? String(mode)}${asked !== undefined ? " (set by the host)" : ""}`,
      actions: actions.get(droplet) ?? "unknown",
    };
  });
  return { element: seen.element, droplets };
}
