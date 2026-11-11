/**
 * The devtools page in the browser. Renders the chosen droplet by asking the
 * dev server for its fragment, exactly as a host page would, and re-renders
 * whenever the droplet or the registry changes.
 */
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
  type Row,
} from "../shared.ts";


type PageData = {
  element: string;
  droplets: DropletInfo[];
  /** `server`: the page arrived with the droplet already rendered in it. */
  mode: "client" | "server";
  server?: { status: number; ms: number; bytes: number; method: Method };
  /** `dev.strategy` of the config. */
  strategy?: string;
};

declare module "vite/types/customEvent.d.ts" {
  interface CustomEventMap {
    "droplets:registry": { droplets: DropletInfo[] };
  }
}

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`devtools: #${id} is missing`);
  return el as T;
}

const data = JSON.parse(byId("dt-data").textContent ?? "{}") as PageData;
let droplets = data.droplets;
const serverMode = data.mode === "server";
/** Client mode keeps its setup here; the URL is server mode's. */
const CLIENT_KEY = "droplets-devtools:client";

function readStored(): string {
  try {
    return localStorage.getItem(CLIENT_KEY) ?? "";
  } catch {
    return "";
  }
}

const state = readToolState(serverMode ? location.search : readStored(), droplets);
let rows: Row[] = rowsFromProps(state.props);
let jsonText = Object.keys(state.props).length ? JSON.stringify(state.props, null, 2) : "{\n  \n}";
let renderSeq = 0;
let renderTimer: ReturnType<typeof setTimeout> | undefined;

const ui = {
  conn: byId("dt-conn"),
  panel: byId("dt-panel"),
  head: byId("dt-head"),
  collapse: byId<HTMLButtonElement>("dt-collapse"),
  pill: byId<HTMLButtonElement>("dt-pill"),
  pillDot: byId("dt-pill-dot"),
  pillStatus: byId("dt-pill-status"),
  select: byId<HTMLSelectElement>("dt-droplet"),
  method: byId("dt-method"),
  methodHint: byId("dt-method-hint"),
  mode: byId("dt-mode"),
  builder: byId("dt-builder"),
  addRow: byId<HTMLButtonElement>("dt-add-row"),
  json: byId<HTMLTextAreaElement>("dt-json"),
  jsonError: byId("dt-json-error"),
  warnings: byId("dt-warnings"),
  modeText: byId("dt-mode-text"),
  info: byId("dt-info"),
  links: byId("dt-links"),
  refresh: byId<HTMLButtonElement>("dt-refresh"),
  status: byId("dt-status"),
  stage: byId("dt-stage"),
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  children: Array<Node | string> = [],
): HTMLElementTagNameMap[K] {
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
    localStorage.setItem(CLIENT_KEY, writeToolState(state));
  } catch {
    // Not remembered across reloads; the page still works.
  }
}

/** The server-mode URL for the current setup. */
function serverUrl(): string {
  return `/${writeToolState(state)}`;
}

function scheduleRender(delay = 250): void {
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
    ...droplets.map((d) => el("option", { value: d.id, textContent: d.id, selected: d.id === state.droplet })),
  );
  ui.select.disabled = droplets.length === 0;
  if (!droplets.length) ui.select.append(el("option", { textContent: "No droplets found" }));
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
  ui.methodHint.textContent = state.method === "GET"
    ? "Props go in the query string."
    : "Props go in a JSON body: { props }.";
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
      const key = el("input", { className: "dt-field", value: row.key, placeholder: "name", spellcheck: false });
      const value = el("input", { className: "dt-field", value: row.value, placeholder: "value", spellcheck: false });
      const remove = el("button", { type: "button", className: "dt-btn dt-icon", title: "Remove", textContent: "×" });
      key.addEventListener("input", () => updateRow(index, { key: key.value }));
      value.addEventListener("input", () => updateRow(index, { value: value.value }));
      remove.addEventListener("click", () => {
        rows.splice(index, 1);
        renderRows();
        propsChanged(propsFromRows(rows));
      });
      return el("div", { className: "dt-row" }, [key, value, remove]);
    }),
  );
}

function updateRow(index: number, patch: Partial<Row>): void {
  const row = rows[index];
  if (!row) return;
  rows[index] = { ...row, ...patch };
  propsChanged(propsFromRows(rows));
}

function propsChanged(props: Record<string, unknown>): void {
  state.props = props;
  persist();
  renderWarnings();
  renderInfo();
  scheduleRender();
}

function renderWarnings(): void {
  ui.warnings.replaceChildren(
    ...propWarnings(state.props, state.method).map((text) => el("p", { className: "dt-note", textContent: text })),
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
    const parsed = parseJsonProps(ui.json.value);
    if (!parsed.ok) {
      ui.jsonError.hidden = false;
      ui.jsonError.textContent = `Fix the JSON before switching: ${parsed.error}`;
      return;
    }
    rows = rowsFromProps(parsed.props);
    renderRows();
  }
  state.mode = value;
  persist();
  renderMode();
});

ui.json.addEventListener("input", () => {
  jsonText = ui.json.value;
  const parsed = parseJsonProps(jsonText);
  ui.jsonError.hidden = parsed.ok;
  if (!parsed.ok) {
    ui.jsonError.textContent = parsed.error;
    return;
  }
  propsChanged(parsed.props);
});

// --- Info panel -----------------------------------------------------------

function flag(on: boolean | string): HTMLElement {
  return el("span", { className: on ? "dt-on" : "dt-off", textContent: typeof on === "string" ? on : on ? "on" : "off" });
}

function link(label: string, href: string): HTMLAnchorElement {
  return el("a", { href, target: "_blank", rel: "noopener", textContent: label });
}

function renderInfo(): void {
  const droplet = current();
  if (!droplet) {
    ui.modeText.replaceChildren();
    ui.info.replaceChildren();
    ui.links.replaceChildren();
    return;
  }
  const mode = describeMode(droplet);
  ui.modeText.replaceChildren(el("strong", { textContent: mode.label }), mode.detail);
  ui.info.replaceChildren(
    el("dt", { textContent: "ssr" }), el("dd", {}, [flag(droplet.ssr)]),
    el("dt", { textContent: "hydrate" }), el("dd", {}, [flag(droplet.hydrate)]),
    el("dt", { textContent: "prerender" }), el("dd", {}, [flag(droplet.prerender === true)]),
    el("dt", { textContent: "+droplet.server.ts" }), el("dd", {}, [flag(droplet.hasServerLoad)]),
    el("dt", { textContent: "+droplet.ts" }), el("dd", {}, [flag(droplet.hasLoad)]),
    el("dt", { textContent: droplet.errorFile ?? "+error.*" }), el("dd", {}, [flag(droplet.hasError === true)]),
    el("dt", { textContent: "folder" }), el("dd", { textContent: droplet.folder }),
    ...(droplet.renderer
      ? [el("dt", { textContent: "renderer" }), el("dd", { textContent: `${droplet.renderer} (${droplet.file ?? ""})` })]
      : []),
  );

  const base = `/droplets/${encodeURIComponent(droplet.id)}`;
  const get = fragmentRequest(droplet.id, "GET", state.props).url;
  ui.links.replaceChildren(
    link(get, get),
    ...(droplet.hydrate ? [link(`${base}/client.js`, `${base}/client.js`)] : []),
    link(`${base}/style.css`, `${base}/style.css`),
    ...(droplet.hasServerLoad ? [link(`${base}/_data`, get.replace(base, `${base}/_data`))] : []),
  );
}

ui.refresh.addEventListener("click", () => void render());

// --- Rendering ------------------------------------------------------------

function setStatus(text: string, ok: boolean | null): void {
  ui.status.textContent = text;
  ui.pillStatus.textContent = state.droplet ? `${state.droplet} · ${text}` : text;
  if (ok === null) delete ui.status.dataset["ok"];
  else ui.status.dataset["ok"] = String(ok);
  ui.pillStatus.dataset["ok"] = ui.status.dataset["ok"] ?? "";
}

function placeholder(text: string): HTMLElement {
  return el("p", { className: "dt-placeholder", textContent: text });
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
      placeholder(droplets.length ? "Pick a droplet." : "No droplets yet: add src/droplets/<name>/+droplet.<ext> for a configured renderer."),
    );
    setStatus("—", null);
    return;
  }

  const seq = ++renderSeq;
  const { url, init } = fragmentRequest(droplet.id, state.method, state.props);
  const started = performance.now();
  let response: Response;
  let body: string;
  try {
    response = await fetch(url, init);
    body = await response.text();
  } catch (error) {
    if (seq !== renderSeq) return;
    setStatus("Request failed", false);
    ui.stage.replaceChildren(el("pre", { className: "dt-failure", textContent: String(error) }));
    return;
  }
  // A newer render started while this one was in flight.
  if (seq !== renderSeq) return;

  const ms = Math.round(performance.now() - started);
  setStatus(
    `${init.method} ${response.status} · ${ms} ms · ${formatBytes(new TextEncoder().encode(body).length)}`,
    response.ok,
  );

  // A failing droplet with an error page still answers its element: show it.
  const isHtml = (response.headers.get("content-type") ?? "").includes("text/html");
  if (!response.ok && !isHtml) {
    ui.stage.replaceChildren(
      el("pre", { className: "dt-failure", textContent: `${response.status} ${response.statusText}\n\n${body}` }),
    );
    return;
  }
  // The loader picks the element up as soon as it is in the document.
  ui.stage.innerHTML = body;
  if (describeMode(droplet).empty) {
    ui.stage.append(placeholder("Empty by design: ssr and hydrate are both off."));
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

if (import.meta.hot) {
  import.meta.hot.on("droplets:update", (payload) => {
    if (payload.droplet !== state.droplet || strategy() === "hmr") return;
    if (serverMode) location.reload();
    else scheduleRender(50);
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
    else scheduleRender(50);
  });

  const connection = (on: boolean) => {
    for (const dot of [ui.conn, ui.pillDot]) {
      dot.dataset["state"] = on ? "on" : "off";
      dot.title = on ? "Connected to the dev server" : "Dev server disconnected";
    }
  };
  import.meta.hot.on("vite:ws:disconnect", () => connection(false));
  import.meta.hot.on("vite:ws:connect", () => connection(true));
}

// --- Client or server rendering -------------------------------------------

const renderToggle = byId("dt-render");
const renderHint = byId("dt-render-hint");

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
    localStorage.setItem(CLIENT_KEY, writeToolState(state));
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
    stored = parsePanelState(localStorage.getItem(PANEL_KEY));
  } catch {
    // Storage can be unavailable; the default position is fine.
  }
  // On a phone the open panel would cover the droplet: start folded.
  return stored ?? {
    x: innerWidth - Math.min(360, innerWidth - 24) - 12,
    y: 12,
    collapsed: innerWidth < 640,
  };
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
  panel = clampPanel(panel, rect, { width: innerWidth, height: innerHeight });
  for (const node of [ui.panel, ui.pill]) {
    node.style.left = `${panel.x}px`;
    node.style.top = `${panel.y}px`;
  }
}

function setCollapsed(collapsed: boolean): void {
  panel = { ...panel, collapsed };
  ui.panel.hidden = collapsed;
  ui.pill.hidden = !collapsed;
  placePanel();
  savePanel();
}

/** Drags `handle`, moving the panel; a click without movement is left alone. */
function draggable(handle: HTMLElement, onClick?: () => void): void {
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

draggable(ui.head);
draggable(ui.pill, () => setCollapsed(false));
ui.collapse.addEventListener("click", () => setCollapsed(true));
addEventListener("resize", placePanel);
addEventListener("keydown", (event) => {
  if (event.altKey && event.code === "KeyD") {
    event.preventDefault();
    setCollapsed(!panel.collapsed);
  }
});

// --- Start ----------------------------------------------------------------

ui.json.value = jsonText;
setCollapsed(panel.collapsed);
renderSelect();
renderMethod();
renderMode();
renderRows();
renderWarnings();
renderInfo();
renderRenderMode();
if (serverMode && data.server) {
  const { method, status, ms, bytes } = data.server;
  setStatus(`${method} ${status} · ${ms} ms (server) · ${formatBytes(bytes)}`, status < 400);
  const droplet = current();
  if (droplet && describeMode(droplet).empty) {
    ui.stage.append(placeholder("Empty by design: ssr and hydrate are both off."));
  }
} else {
  void render();
}
