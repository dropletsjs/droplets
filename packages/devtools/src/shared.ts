/**
 * Logic shared by the plugin (`index.ts`, in Node) and the browser scripts:
 * the devtools page (`client/devtools-page.ts`) and the floating panel
 * (`tool/panel.ts`). No DOM, no Node: plain functions over plain data.
 */

/** One droplet, as the core plugin describes it. */
export type DropletInfo = {
  id: string;
  folder: string;
  ssr: boolean;
  /** `true`, `"visible"` or `"interactive"`: when it hydrates; `false`: never. */
  hydrate: boolean | "visible" | "interactive";
  hasLoad: boolean;
  hasServerLoad: boolean;
  /** The component's file name, e.g. `+droplet.svelte`. */
  file?: string;
  /** The renderer that handles it. */
  renderer?: string;
  /** Has its own error page (`+error.<ext>`). */
  hasError?: boolean;
  /** The error page's file name, when it has one. */
  errorFile?: string;
  /** Rendered at build for `entries`; renders live in dev. */
  prerender?: boolean;
};

export type Method = "GET" | "POST";
export type EditorMode = "builder" | "json";
export type Props = Record<string, unknown>;
export type Row = { key: string; value: string };

/** What the page remembers in its own URL, so a reload keeps the setup. */
export type ToolState = {
  droplet: string | null;
  method: Method;
  mode: EditorMode;
  props: Props;
};

/** Query keys the droplets server keeps for itself; never props. */
export const RESERVED_KEYS = new Set(["__cb", "c", "t", "noSSR", "clientOnly"]);

export type RenderMode = {
  label: string;
  detail: string;
  /** Whether anything at all ends up on the page. */
  empty: boolean;
};

/** How `ssr` and `hydrate` combine for one droplet. */
export function describeMode(droplet: DropletInfo): RenderMode {
  if (droplet.ssr && droplet.hydrate) {
    const when =
      droplet.hydrate === "visible"
        ? " as it is about to scroll into view"
        : droplet.hydrate === "interactive"
          ? " on the first interaction with it"
          : "";
    return {
      label: droplet.hydrate === true ? "SSR + hydrate" : `SSR + hydrate (${droplet.hydrate})`,
      detail: `Rendered on the server, then hydrated in the browser${when}.`,
      empty: false,
    };
  }
  if (droplet.ssr) {
    return {
      label: "Static HTML",
      detail: "Rendered on the server. No JavaScript loads in the browser.",
      empty: false,
    };
  }
  if (droplet.hydrate) {
    return {
      label: "Client render",
      detail: droplet.hasServerLoad
        ? "No server HTML. The server load runs and its data is inlined; the browser mounts the component."
        : "No server HTML. The browser mounts the component.",
      empty: false,
    };
  }
  return {
    label: "Empty",
    detail: "ssr and hydrate are both off: nothing renders on the server and nothing loads in the browser.",
    empty: true,
  };
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : (JSON.stringify(value) ?? "");
}

/** Props as a query string. Non-string values travel as JSON text. */
export function propsToQuery(props: Props): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(props)) {
    if (key) params.append(key, asText(value));
  }
  return params.toString();
}

/** Builder rows -> props. Empty keys are skipped; later keys win. */
export function propsFromRows(rows: Row[]): Props {
  const props: Props = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (key) props[key] = row.value;
  }
  return props;
}

/** Props -> builder rows, with non-string values shown as JSON. */
export function rowsFromProps(props: Props): Row[] {
  return Object.entries(props).map(([key, value]) => ({ key, value: asText(value) }));
}

export type JsonResult = { ok: true; props: Props } | { ok: false; error: string };

/** The JSON editor's text -> props, or why it is not a props object. */
export function parseJsonProps(text: string): JsonResult {
  if (!text.trim()) return { ok: true, props: {} };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, error: 'Props must be a JSON object, like { "who": "Ana" }.' };
  }
  return { ok: true, props: value as Props };
}

/** Things worth telling the user about the props they are about to send. */
export function propWarnings(props: Props, method: Method): string[] {
  const warnings: string[] = [];
  const reserved = Object.keys(props).filter((key) => RESERVED_KEYS.has(key));
  if (reserved.length) {
    warnings.push(
      `${reserved.join(", ")} ${reserved.length === 1 ? "is" : "are"} reserved by droplets and never reach the droplet as props.`,
    );
  }
  if (method === "GET" && Object.values(props).some((value) => typeof value !== "string")) {
    warnings.push("GET sends every value as text. Use POST to send numbers, booleans or objects as they are.");
  }
  return warnings;
}

/** The fragment request the page makes for the current state. */
export function fragmentRequest(droplet: string, method: Method, props: Props): { url: string; init: RequestInit } {
  const path = `/droplets/${encodeURIComponent(droplet)}`;
  if (method === "POST") {
    return {
      url: path,
      init: {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ props }),
      },
    };
  }
  const query = propsToQuery(props);
  return { url: query ? `${path}?${query}` : path, init: { method: "GET" } };
}

/** Reads the page's own query string, falling back to the first droplet. */
export function readToolState(search: string, droplets: DropletInfo[]): ToolState {
  const params = new URLSearchParams(search);
  const wanted = params.get("droplet");
  const droplet = droplets.find((d) => d.id === wanted)?.id ?? droplets[0]?.id ?? null;
  const parsed = parseJsonProps(params.get("props") ?? "");
  return {
    droplet,
    method: params.get("method") === "POST" ? "POST" : "GET",
    mode: params.get("mode") === "json" ? "json" : "builder",
    props: parsed.ok ? parsed.props : {},
  };
}

export function writeToolState(state: ToolState): string {
  const params = new URLSearchParams();
  if (state.droplet) params.set("droplet", state.droplet);
  if (state.method !== "GET") params.set("method", state.method);
  if (state.mode !== "builder") params.set("mode", state.mode);
  if (Object.keys(state.props).length) params.set("props", JSON.stringify(state.props));
  const query = params.toString();
  return query ? `?${query}` : "";
}

/** Where the floating panel sits, and whether it is folded into the pill. */
export type PanelState = { x: number; y: number; collapsed: boolean };

/** Keeps the panel reachable: at least `margin` px of it inside the viewport. */
export function clampPanel(
  state: PanelState,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  margin = 12,
): PanelState {
  const maxX = Math.max(margin, viewport.width - size.width - margin);
  const maxY = Math.max(margin, viewport.height - Math.min(size.height, 48) - margin);
  return {
    ...state,
    x: Math.min(Math.max(margin, state.x), maxX),
    y: Math.min(Math.max(margin, state.y), maxY),
  };
}

/** Reads a stored panel state, or `null` when there is nothing usable. */
export function parsePanelState(raw: string | null): PanelState | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PanelState>;
    if (typeof value.x !== "number" || typeof value.y !== "number") return null;
    return { x: value.x, y: value.y, collapsed: value.collapsed === true };
  } catch {
    return null;
  }
}

/** `1.2 kB`, `840 B`. */
export function formatBytes(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} kB`;
}
