import { raw } from "hono/html";
import STYLES from "./page.css?inline";
import type { DropletInfo, Method } from "./shared.ts";

/** A droplet rendered on the server, for server mode. */
export type ServerRender = {
  droplet: string;
  method: Method;
  props: Record<string, unknown>;
  status: number;
  /** Milliseconds the fragment took. */
  ms: number;
  bytes: number;
  /** The fragment as the droplets server answered it. */
  html: string;
  /** Stylesheets the droplet needs, put in `<head>` so nothing flashes. */
  styles: string[];
};

export type DevtoolsPageInput = {
  element: string;
  droplets: DropletInfo[];
  /** The `<script type="importmap">` block, or `""`. */
  importMap?: string;
  /** The droplets loader, `/index.js`. */
  loaderUrl: string;
  /** The devtools' own browser script, as a URL Vite serves. */
  clientUrl: string;
  /** Present in server mode: the droplet, already rendered. */
  server?: ServerRender | undefined;
  /** `dev.strategy` of the config: under `hmr` the page leaves edits to the element. */
  strategy?: string;
  /** `false` leaves the page's own `<style>` out, for `withPageStyles` to add. */
  pageStyles?: boolean;
};

/** The page's own `<style>`, last in `<head>`, as `renderDevtoolsPage` puts it. */
export function withPageStyles(html: string): string {
  return html.replace("</head>", () => `<style>${STYLES}</style></head>`);
}

/** JSON that cannot close the `<script>` it sits in. */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function Segmented(props: { id: string; options: Array<[string, string]> }) {
  return (
    <span class="dt-seg" id={props.id}>
      {props.options.map(([value, label]) => <button type="button" data-value={value}>{label}</button>)}
    </span>
  );
}

function Panel(props: { element: string }) {
  return (
    <aside class="dt-panel" id="dt-panel" aria-label="Droplets devtools">
      <header class="dt-head" id="dt-head" title="Drag to move">
        <span class="dt-dot" id="dt-conn"></span>
        <h1>Droplets devtools</h1>
        <code>{`<${props.element}>`}</code>
        <button type="button" class="dt-btn dt-icon" id="dt-collapse" title="Collapse (Alt+D)">–</button>
      </header>
      <div class="dt-body">
        <section class="dt-section">
          <div class="dt-label">
            Render
            <Segmented id="dt-render" options={[["client", "Client"], ["server", "Server"]]} />
          </div>
          <span class="dt-status" id="dt-render-hint"></span>
        </section>
        <section class="dt-section">
          <label class="dt-label" for="dt-droplet">Droplet</label>
          <select class="dt-select" id="dt-droplet"></select>
        </section>
        <section class="dt-section">
          <div class="dt-label">
            Request
            <Segmented id="dt-method" options={[["GET", "GET"], ["POST", "POST"]]} />
          </div>
          <span class="dt-status" id="dt-method-hint"></span>
        </section>
        <section class="dt-section">
          <div class="dt-label">
            Props
            <Segmented id="dt-mode" options={[["builder", "Builder"], ["json", "JSON"]]} />
          </div>
          <div id="dt-builder" class="dt-rows"></div>
          <button type="button" class="dt-btn" id="dt-add-row">Add prop</button>
          <textarea class="dt-textarea" id="dt-json" spellcheck={false} hidden></textarea>
          <p class="dt-error" id="dt-json-error" hidden></p>
          <div id="dt-warnings"></div>
        </section>
        <section class="dt-section">
          <div class="dt-label">Droplet info</div>
          <p class="dt-mode" id="dt-mode-text"></p>
          <dl class="dt-info" id="dt-info"></dl>
          <div class="dt-links" id="dt-links"></div>
        </section>
        <section class="dt-section">
          <div class="dt-label">
            Last response
            <button type="button" class="dt-btn" id="dt-refresh">Render again</button>
          </div>
          <span class="dt-status" id="dt-status">Not rendered yet</span>
        </section>
      </div>
    </aside>
  );
}

/**
 * The devtools page, rendered on the server. In server mode it already holds
 * the droplet, the way a host that renders on the server would show it; in
 * client mode the browser script fetches and inserts it.
 */
export function renderDevtoolsPage(input: DevtoolsPageInput): string {
  const data = {
    element: input.element,
    droplets: input.droplets,
    mode: input.server ? "server" : "client",
    strategy: input.strategy ?? "hmr",
    ...(input.server
      ? {
        server: {
          droplet: input.server.droplet,
          method: input.server.method,
          props: input.server.props,
          status: input.server.status,
          ms: input.server.ms,
          bytes: input.server.bytes,
        },
      }
      : {}),
  };

  const page = (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Droplets devtools</title>
        {raw(input.importMap ?? "")}
        {(input.server?.styles ?? []).map((href) => <link rel="stylesheet" href={href} />)}
        {input.pageStyles === false ? "" : <style>{raw(STYLES)}</style>}
      </head>
      <body>
        <div id="dt-stage">{raw(input.server?.html ?? "")}</div>
        <button type="button" class="dt-pill" id="dt-pill" hidden title="Open devtools (Alt+D)">
          <span class="dt-dot" id="dt-pill-dot"></span>
          <strong>droplets</strong>
          <span class="dt-status" id="dt-pill-status"></span>
        </button>
        <Panel element={input.element} />
        <script type="application/json" id="dt-data">{raw(jsonForScript(data))}</script>
        {/* The dev tool is always on here: the page is a host like any other.
            vite-ignore: the droplets app serves index.js, not Vite's module
            graph, so Vite's pre-transform of it would only log an error. */}
        <script type="module" vite-ignore src={`${input.loaderUrl}?injectTool=true`}></script>
        <script type="module" src={input.clientUrl}></script>
      </body>
    </html>
  );
  return `<!doctype html>\n${page.toString()}`;
}
