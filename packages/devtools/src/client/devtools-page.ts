/**
 * The devtools page in the browser. Renders the chosen droplet by asking the
 * dev server for its fragment, exactly as a host page would, and re-renders
 * whenever the droplet or the registry changes.
 */
import type { DropletRegistryPayload } from "@dropletsjs/droplets/vite";
import type { ServerRender } from "../page.tsx";
import {
  clampPanel,
  describeMode,
  formatBytes,
  fragmentRequest,
  parsePanelState,
  parseJsonProps,
  propsFromRows,
  propWarnings,
  readToolState,
  rowsFromProps,
  writeToolState,
  type DropletInfo,
  type EditorMode,
  type Method,
  type PanelState,
  type Props,
  type Row,
} from "../shared.ts";

type PageData = {
  element: string;
  droplets: DropletInfo[];
  /** `server`: the page arrived with the droplet already rendered in it. */
  mode: "client" | "server";
  server?: Pick<ServerRender, "status" | "ms" | "bytes" | "method">;
  /** `dev.strategy` of the config. */
  strategy?: string;
};

declare module "vite/types/customEvent.d.ts" {
  // biome-ignore lint/style/useConsistentTypeDefinitions: an augmentation of Vite's map; `type` cannot merge.
  interface CustomEventMap {
    "droplets:registry": DropletRegistryPayload;
  }
}

type ByIdInput = { id: string };

function byId<T extends HTMLElement>({ id }: ByIdInput): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`devtools: #${id} is missing`);
  return el as T;
}

const data = JSON.parse(byId({ id: "dt-data" }).textContent ?? "{}") as PageData;
let droplets = data.droplets;
const serverMode = data.mode === "server";
/** Client mode keeps its setup here; the URL is server mode's. */
const CLIENT_KEY = "droplets-devtools:client";

function readStored(): string {
  try {
    return localStorage.getItem(CLIENT_KEY) ?? "";
  } catch {
    // Storage blocked: start from the defaults.
    return "";
  }
}

const state = readToolState({ search: serverMode ? location.search : readStored(), droplets });
let rows: Row[] = rowsFromProps({ props: state.props });
let jsonText = Object.keys(state.props).length ? JSON.stringify(state.props, null, 2) : "{\n  \n}";
let renderSeq = 0;
let renderTimer: ReturnType<typeof setTimeout> | undefined;

const ui = {
  conn: byId({ id: "dt-conn" }),
  panel: byId({ id: "dt-panel" }),
  head: byId({ id: "dt-head" }),
  collapse: byId<HTMLButtonElement>({ id: "dt-collapse" }),
  pill: byId<HTMLButtonElement>({ id: "dt-pill" }),
  pillDot: byId({ id: "dt-pill-dot" }),
  pillStatus: byId({ id: "dt-pill-status" }),
  select: byId<HTMLSelectElement>({ id: "dt-droplet" }),
  method: byId({ id: "dt-method" }),
  methodHint: byId({ id: "dt-method-hint" }),
  mode: byId({ id: "dt-mode" }),
  builder: byId({ id: "dt-builder" }),
  addRow: byId<HTMLButtonElement>({ id: "dt-add-row" }),
  json: byId<HTMLTextAreaElement>({ id: "dt-json" }),
  jsonError: byId({ id: "dt-json-error" }),
  warnings: byId({ id: "dt-warnings" }),
  modeText: byId({ id: "dt-mode-text" }),
  info: byId({ id: "dt-info" }),
  links: byId({ id: "dt-links" }),
  refresh: byId<HTMLButtonElement>({ id: "dt-refresh" }),
  status: byId({ id: "dt-status" }),
  stage: byId({ id: "dt-stage" }),
};

type ElInput<K extends keyof HTMLElementTagNameMap> = {
  tag: K;
  props?: Partial<HTMLElementTagNameMap[K]>;
  children?: Array<Node | string>;
};

function el<K extends keyof HTMLElementTagNameMap>({ tag, props = {}, children = [] }: ElInput<K>): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function current(): DropletInfo | undefined {
  return droplets.find((d) => d.id === state.droplet);
}

function persist(): void {
  if (serverMode) return;
  try {
    localStorage.setItem(CLIENT_KEY, writeToolState({ state }));
  } catch {
    // Not remembered across reloads; the page still works.
  }
}

/** The server-mode URL for the current setup. */
function serverUrl(): string {
  return `/${writeToolState({ state })}`;
}

type ScheduleRenderInput = { delay?: number };

function scheduleRender({ delay = 250 }: ScheduleRenderInput = {}): void {
  // In server mode every render is a page load: wait for "Render again".
  if (serverMode) {
    ui.refresh.textContent = "Apply and render";
    return;
  }
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => void render(), delay);
}

// --- Droplet picker -------------------------------------------------------

function renderSelect(): void {
  ui.select.replaceChildren(
    ...droplets.map((d) => el({ tag: "option", props: { value: d.id, textContent: d.id, selected: d.id === state.droplet } })),
  );
  ui.select.disabled = droplets.length === 0;
  if (!droplets.length) ui.select.append(el({ tag: "option", props: { textContent: "No droplets found" } }));
}

ui.select.addEventListener("change", () => {
  state.droplet = ui.select.value;
  persist();
  renderInfo();
  void render();
});

// --- Request method -------------------------------------------------------

function renderMethod(): void {
  for (const button of ui.method.querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(button.dataset["value"] === state.method));
  }
  ui.methodHint.textContent = state.method === "GET" ? "Props go in the query string." : "Props go in a JSON body: { props }.";
}

ui.method.addEventListener("click", (event) => {
  const value = (event.target as HTMLElement).dataset["value"] as Method | undefined;
  if (!value || value === state.method) return;
  state.method = value;
  persist();
  renderMethod();
  renderWarnings();
  renderInfo();
  void render();
});

// --- Props editor ---------------------------------------------------------

function renderMode(): void {
  for (const button of ui.mode.querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(button.dataset["value"] === state.mode));
  }
  const json = state.mode === "json";
  ui.builder.hidden = json;
  ui.addRow.hidden = json;
  ui.json.hidden = !json;
  ui.jsonError.hidden = true;
}

function renderRows(): void {
  ui.builder.replaceChildren(
    ...rows.map((row, index) => {
      const key = el({ tag: "input", props: { className: "dt-field", value: row.key, placeholder: "name", spellcheck: false } });
      const value = el({ tag: "input", props: { className: "dt-field", value: row.value, placeholder: "value", spellcheck: false } });
      const remove = el({ tag: "button", props: { type: "button", className: "dt-btn dt-icon", title: "Remove", textContent: "×" } });
      key.addEventListener("input", () => updateRow({ index, patch: { key: key.value } }));
      value.addEventListener("input", () => updateRow({ index, patch: { value: value.value } }));
      remove.addEventListener("click", () => {
        rows.splice(index, 1);
        renderRows();
        propsChanged({ props: propsFromRows({ rows }) });
      });
      return el({ tag: "div", props: { className: "dt-row" }, children: [key, value, remove] });
    }),
  );
}

type UpdateRowInput = { index: number; patch: Partial<Row> };

function updateRow({ index, patch }: UpdateRowInput): void {
  const row = rows[index];
  if (!row) return;
  rows[index] = { ...row, ...patch };
  propsChanged({ props: propsFromRows({ rows }) });
}

type PropsChangedInput = { props: Props };

function propsChanged({ props }: PropsChangedInput): void {
  state.props = props;
  persist();
  renderWarnings();
  renderInfo();
  scheduleRender();
}

function renderWarnings(): void {
  ui.warnings.replaceChildren(
    ...propWarnings({ props: state.props, method: state.method }).map((text) =>
      el({ tag: "p", props: { className: "dt-note", textContent: text } }),
    ),
  );
}

ui.addRow.addEventListener("click", () => {
  rows.push({ key: "", value: "" });
  renderRows();
  ui.builder.querySelector<HTMLInputElement>(".dt-row:last-child input")?.focus();
});

ui.mode.addEventListener("click", (event) => {
  const value = (event.target as HTMLElement).dataset["value"] as EditorMode | undefined;
  if (!value || value === state.mode) return;
  if (value === "json") {
    // The builder's props are always valid JSON.
    jsonText = JSON.stringify(state.props, null, 2);
    ui.json.value = jsonText;
  } else {
    const parsed = parseJsonProps({ text: ui.json.value });
    if (!parsed.ok) {
      ui.jsonError.hidden = false;
      ui.jsonError.textContent = `Fix the JSON before switching: ${parsed.error}`;
      return;
    }
    rows = rowsFromProps({ props: parsed.props });
    renderRows();
  }
  state.mode = value;
  persist();
  renderMode();
});

ui.json.addEventListener("input", () => {
  jsonText = ui.json.value;
  const parsed = parseJsonProps({ text: jsonText });
  ui.jsonError.hidden = parsed.ok;
  if (!parsed.ok) {
    ui.jsonError.textContent = parsed.error;
    return;
  }
  propsChanged({ props: parsed.props });
});

// --- Info panel -----------------------------------------------------------

type FlagInput = { on: boolean | string };

function flag({ on }: FlagInput): HTMLElement {
  return el({ tag: "span", props: { className: on ? "dt-on" : "dt-off", textContent: typeof on === "string" ? on : on ? "on" : "off" } });
}

type LinkInput = { label: string; href: string };

function link({ label, href }: LinkInput): HTMLAnchorElement {
  return el({ tag: "a", props: { href, target: "_blank", rel: "noopener", textContent: label } });
}

function renderInfo(): void {
  const droplet = current();
  if (!droplet) {
    ui.modeText.replaceChildren();
    ui.info.replaceChildren();
    ui.links.replaceChildren();
    return;
  }
  const mode = describeMode({ droplet });
  ui.modeText.replaceChildren(el({ tag: "strong", props: { textContent: mode.label } }), mode.detail);
  ui.info.replaceChildren(
    el({ tag: "dt", props: { textContent: "ssr" } }),
    el({ tag: "dd", children: [flag({ on: droplet.ssr })] }),
    el({ tag: "dt", props: { textContent: "hydrate" } }),
    el({ tag: "dd", children: [flag({ on: droplet.hydrate })] }),
    el({ tag: "dt", props: { textContent: "prerender" } }),
    el({ tag: "dd", children: [flag({ on: droplet.prerender === true })] }),
    el({ tag: "dt", props: { textContent: "+droplet.server.ts" } }),
    el({ tag: "dd", children: [flag({ on: droplet.hasServerLoad })] }),
    el({ tag: "dt", props: { textContent: "+droplet.ts" } }),
    el({ tag: "dd", children: [flag({ on: droplet.hasLoad })] }),
    el({ tag: "dt", props: { textContent: droplet.errorFile ?? "+error.*" } }),
    el({ tag: "dd", children: [flag({ on: droplet.hasError === true })] }),
    el({ tag: "dt", props: { textContent: "folder" } }),
    el({ tag: "dd", props: { textContent: droplet.folder } }),
    ...(droplet.renderer
      ? [
          el({ tag: "dt", props: { textContent: "renderer" } }),
          el({ tag: "dd", props: { textContent: `${droplet.renderer} (${droplet.file ?? ""})` } }),
        ]
      : []),
  );

  const base = `/droplets/${encodeURIComponent(droplet.id)}`;
  const get = fragmentRequest({ droplet: droplet.id, method: "GET", props: state.props }).url;
  ui.links.replaceChildren(
    link({ label: get, href: get }),
    ...(droplet.hydrate ? [link({ label: `${base}/client.js`, href: `${base}/client.js` })] : []),
    link({ label: `${base}/style.css`, href: `${base}/style.css` }),
    ...(droplet.hasServerLoad ? [link({ label: `${base}/_data`, href: get.replace(base, `${base}/_data`) })] : []),
  );
}

ui.refresh.addEventListener("click", () => void render());

// --- Rendering ------------------------------------------------------------

type SetStatusInput = { text: string; ok: boolean | null };

function setStatus({ text, ok }: SetStatusInput): void {
  ui.status.textContent = text;
  ui.pillStatus.textContent = state.droplet ? `${state.droplet} · ${text}` : text;
  if (ok === null) delete ui.status.dataset["ok"];
  else ui.status.dataset["ok"] = String(ok);
  ui.pillStatus.dataset["ok"] = ui.status.dataset["ok"] ?? "";
}

type PlaceholderInput = { text: string };

function placeholder({ text }: PlaceholderInput): HTMLElement {
  return el({ tag: "p", props: { className: "dt-placeholder", textContent: text } });
}

async function render(): Promise<void> {
  clearTimeout(renderTimer);
  // Server mode renders on the server: a new setup is a new page.
  if (serverMode) {
    if (state.droplet) location.assign(serverUrl());
    return;
  }
  const droplet = current();
  if (!droplet) {
    ui.stage.replaceChildren(
      placeholder({
        text: droplets.length ? "Pick a droplet." : "No droplets yet: add src/droplets/<name>/+droplet.<ext> for a configured renderer.",
      }),
    );
    setStatus({ text: "—", ok: null });
    return;
  }

  const seq = ++renderSeq;
  const { url, init } = fragmentRequest({ droplet: droplet.id, method: state.method, props: state.props });
  const started = performance.now();
  let response: Response;
  let body: string;
  try {
    response = await fetch(url, init);
    body = await response.text();
  } catch (error) {
    if (seq !== renderSeq) return;
    setStatus({ text: "Request failed", ok: false });
    ui.stage.replaceChildren(el({ tag: "pre", props: { className: "dt-failure", textContent: String(error) } }));
    return;
  }
  // A newer render started while this one was in flight.
  if (seq !== renderSeq) return;

  const ms = Math.round(performance.now() - started);
  setStatus({
    text: `${init.method} ${response.status} · ${ms} ms · ${formatBytes({ bytes: new TextEncoder().encode(body).length })}`,
    ok: response.ok,
  });

  // A failing droplet with an error page still answers its element: show it.
  const isHtml = (response.headers.get("content-type") ?? "").includes("text/html");
  if (!response.ok && !isHtml) {
    ui.stage.replaceChildren(
      el({ tag: "pre", props: { className: "dt-failure", textContent: `${response.status} ${response.statusText}\n\n${body}` } }),
    );
    return;
  }
  // The loader picks the element up as soon as it is in the document.
  ui.stage.innerHTML = body;
  if (describeMode({ droplet }).empty) {
    ui.stage.append(placeholder({ text: "Empty by design: ssr and hydrate are both off." }));
  }
}

// --- Live updates ---------------------------------------------------------

/**
 * The strategy the page's loader follows: the dev tool's choice for this
 * server, kept for the tab's session, else the config's. Under `hmr` the
 * element on the stage handles every edit itself, in place; the page
 * renders nothing again and never reloads.
 */
function strategy(): string {
  try {
    const chosen = sessionStorage.getItem(`droplets:strategy:${location.origin}`);
    if (chosen) return chosen;
  } catch {
    // Storage blocked: the config's choice stands.
  }
  return data.strategy ?? "hmr";
}

type ShowConnectionInput = { isOn: boolean };

function showConnection({ isOn }: ShowConnectionInput): void {
  for (const dot of [ui.conn, ui.pillDot]) {
    dot.dataset["state"] = isOn ? "on" : "off";
    dot.title = isOn ? "Connected to the dev server" : "Dev server disconnected";
  }
}

if (import.meta.hot) {
  import.meta.hot.on("droplets:update", (payload) => {
    if (payload.droplet !== state.droplet || strategy() === "hmr") return;
    if (serverMode) location.reload();
    else scheduleRender({ delay: 50 });
  });

  import.meta.hot.on("droplets:registry", (payload) => {
    const before = JSON.stringify(current() ?? null);
    droplets = payload.droplets;
    if (!current()) state.droplet = droplets[0]?.id ?? null;
    persist();
    renderSelect();
    renderInfo();
    if (JSON.stringify(current() ?? null) === before || strategy() === "hmr") return;
    if (serverMode) location.reload();
    else scheduleRender({ delay: 50 });
  });

  import.meta.hot.on("vite:ws:disconnect", () => showConnection({ isOn: false }));
  import.meta.hot.on("vite:ws:connect", () => showConnection({ isOn: true }));
}

// --- Client or server rendering -------------------------------------------

const renderToggle = byId({ id: "dt-render" });
const renderHint = byId({ id: "dt-render-hint" });

function renderRenderMode(): void {
  for (const button of renderToggle.querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(button.dataset["value"] === data.mode));
  }
  renderHint.textContent = serverMode
    ? "Rendered on the server, as by a host that renders server-side. Each render loads the page again."
    : "The browser fetches the fragment and inserts it.";
}

renderToggle.addEventListener("click", (event) => {
  const value = (event.target as HTMLElement).dataset["value"];
  if (!value || value === data.mode) return;
  if (value === "server") {
    if (state.droplet) location.assign(serverUrl());
    return;
  }
  // Carry the setup over to client mode, then leave the server URL.
  try {
    localStorage.setItem(CLIENT_KEY, writeToolState({ state }));
  } catch {
    // Starts from defaults instead.
  }
  location.assign("/");
});

// --- Floating panel -------------------------------------------------------

const PANEL_KEY = "droplets-devtools:panel";

function readPanel(): PanelState {
  let stored: PanelState | null = null;
  try {
    stored = parsePanelState({ raw: localStorage.getItem(PANEL_KEY) });
  } catch {
    // Storage can be unavailable; the default position is fine.
  }
  // On a phone the open panel would cover the droplet: start folded.
  return (
    stored ?? {
      x: innerWidth - Math.min(360, innerWidth - 24) - 12,
      y: 12,
      collapsed: innerWidth < 640,
    }
  );
}

let panel = readPanel();

function savePanel(): void {
  try {
    localStorage.setItem(PANEL_KEY, JSON.stringify(panel));
  } catch {
    // Not remembered across reloads; nothing else depends on it.
  }
}

function placePanel(): void {
  const target = panel.collapsed ? ui.pill : ui.panel;
  const rect = target.getBoundingClientRect();
  panel = clampPanel({ state: panel, size: rect, viewport: { width: innerWidth, height: innerHeight } });
  for (const node of [ui.panel, ui.pill]) {
    node.style.left = `${panel.x}px`;
    node.style.top = `${panel.y}px`;
  }
}

type SetCollapsedInput = { collapsed: boolean };

function setCollapsed({ collapsed }: SetCollapsedInput): void {
  panel = { ...panel, collapsed };
  ui.panel.hidden = collapsed;
  ui.pill.hidden = !collapsed;
  placePanel();
  savePanel();
}

type DraggableInput = { handle: HTMLElement; onClick?: () => void };

/** Drags `handle`, moving the panel; a click without movement is left alone. */
function draggable({ handle, onClick }: DraggableInput): void {
  handle.addEventListener("pointerdown", (down) => {
    if ((down.target as HTMLElement).closest("button") && handle !== ui.pill) return;
    const start = { x: down.clientX, y: down.clientY, panelX: panel.x, panelY: panel.y };
    let moved = false;
    handle.setPointerCapture(down.pointerId);
    const move = (event: PointerEvent) => {
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      moved = true;
      panel = { ...panel, x: start.panelX + dx, y: start.panelY + dy };
      placePanel();
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      if (moved) savePanel();
      else onClick?.();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  });
}

draggable({ handle: ui.head });
draggable({ handle: ui.pill, onClick: () => setCollapsed({ collapsed: false }) });
ui.collapse.addEventListener("click", () => setCollapsed({ collapsed: true }));
addEventListener("resize", placePanel);
addEventListener("keydown", (event) => {
  if (event.altKey && event.code === "KeyD") {
    event.preventDefault();
    setCollapsed({ collapsed: !panel.collapsed });
  }
});

// --- Start ----------------------------------------------------------------

ui.json.value = jsonText;
setCollapsed({ collapsed: panel.collapsed });
renderSelect();
renderMethod();
renderMode();
renderRows();
renderWarnings();
renderInfo();
renderRenderMode();
if (serverMode && data.server) {
  const { method, status, ms, bytes } = data.server;
  setStatus({ text: `${method} ${status} · ${ms} ms (server) · ${formatBytes({ bytes })}`, ok: status < 400 });
  const droplet = current();
  if (droplet && describeMode({ droplet }).empty) {
    ui.stage.append(placeholder({ text: "Empty by design: ssr and hydrate are both off." }));
  }
} else {
  void render();
}
