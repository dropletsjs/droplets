/**
 * `enhanceDropletForm(form, options?)`: progressive enhancement for one
 * form of a droplet, opt-in. Without it a form posts as any form does, a
 * navigation to the droplet's action; with it the submit goes by `fetch`,
 * as JSON, and the result shows in place.
 *
 * Browser code with no state beyond the forms in flight, shared by
 * `$droplets/form` (a droplet's bundle), the renderers' `./form` wrappers
 * and `/index.js` (the `data-droplet-enhance` attribute). Importing it is
 * harmless on the server: nothing runs until a form is enhanced.
 *
 * Attributes are read with `getAttribute`, never through `form.action`,
 * `form.method` and the like: a control named `action` or `method` shadows
 * those properties (`<input name="action">` makes `form.action` the input).
 *
 * @module
 */

/** The encodings an action takes; a `text/plain` form is left to the browser (the server answers `415`). */
const ENCTYPES = new Set(["application/x-www-form-urlencoded", "multipart/form-data"]);

/**
 * A droplet's actions by name, each with what `form` gets after it (its
 * success data, or its `fail()` data): `DropletActions` of `./$types`.
 */
export type ActionMap = Record<string, unknown>;

/** An action name of `A`: any string for the untyped map. */
export type ActionName<A extends ActionMap = ActionMap> = keyof A & string;

/** What `onSubmit` gets, before anything is sent. */
export type EnhanceSubmit = {
  form: HTMLFormElement;
  /** The fields as they are now, the submitter's included: change them here to change what is sent. */
  formData: FormData;
  /** Sends nothing: the submit ends here (the browser does not post it either). */
  cancel(): void;
};

/**
 * What `onResult` gets once the action answered. `update()` does what
 * happens without `onResult`: the droplet renders again with `form`, or
 * the page goes where a redirect points.
 */
export type EnhanceResult<Data = unknown> =
  | { type: "success" | "failure"; status: number; data: Data; update(): Promise<void> }
  | { type: "redirect"; status: number; data: undefined; location: string; update(): Promise<void> };

/**
 * `enhanceDropletForm`'s options. `action` names the action the form posts
 * to: a submit to another one is left to the browser. With a typed `A`
 * (`DropletActions` of `./$types`) it takes only the names `actions`
 * exports, and `onResult`'s `data` is that action's (`K`).
 */
export type EnhanceOptions<A extends ActionMap = ActionMap, K extends ActionName<A> = ActionName<A>> = {
  action?: K;
  /** Before anything is sent: change the fields, or `cancel()`. */
  onSubmit?: (submit: EnhanceSubmit) => void;
  /** Once the action answered, in place of what happens by default (`update()`). */
  onResult?: (result: EnhanceResult<A[K]>) => void | Promise<void>;
};

/**
 * The options for one of `A`'s actions: `action` given, `onResult`'s
 * `data` that action's. What the enhance helpers take when `action` is set.
 */
export type ActionEnhanceOptions<A extends ActionMap = ActionMap> = {
  [K in ActionName<A>]: EnhanceOptions<A, K> & { action: K };
}[ActionName<A>];

/** The options without `action`: any of `A`'s actions, `onResult`'s `data` any of theirs. */
export type AnyEnhanceOptions<A extends ActionMap = ActionMap> = EnhanceOptions<A> & { action?: undefined };

/** `detail` of `droplets:action`, dispatched on `window` after an enhanced submit got its result. */
export type DropletActionDetail = {
  droplet: string;
  /** The action's name: `default`, or the `?/name` of its URL. */
  action: string;
  type: "success" | "failure" | "redirect";
  status: number;
  /** What the action returned or `fail()`ed with, as plain JSON (a copy); `undefined` for a redirect. */
  data: unknown;
};

export const ACTION_EVENT = "droplets:action";

/**
 * What a droplet's element offers a form inside it (`DjsDropletElement`):
 * where its actions are, and a render with an action's result.
 */
export type DropletFormHost = Element & {
  /** The droplet and the location its actions are on; `null` while it renders nothing of a known droplet. */
  actionTarget(): { droplet: string; location: string } | null;
  /**
   * Renders the droplet again with `form`, its loads run again (as a
   * `_data` refresh); one that does not render in the browser gets its
   * fragment rendered with `form` by the server, in place of its content.
   */
  updateForm(form: unknown): Promise<void>;
};

/** A submit as the browser would send it: the submitter's `form*` attributes over the form's. */
export type Submission = {
  /** The effective action, resolved against `base`; `null` when it does not parse. */
  action: URL | null;
  /** Lower-cased; `get` when neither says. */
  method: string;
  /** Lower-cased; `application/x-www-form-urlencoded` when neither says, or says something unknown. */
  enctype: string;
  /** As written; empty when neither says. */
  target: string;
};

/** The submit button or input that submitted `form`; `null` for `requestSubmit()` without one. */
export function submitterOf(event: Event, form: HTMLFormElement): HTMLButtonElement | HTMLInputElement | null {
  const submitter = (event as SubmitEvent).submitter;
  if (!(submitter instanceof HTMLButtonElement || submitter instanceof HTMLInputElement)) return null;
  // Only a control that belongs to this form submits it.
  return submitter.form === form ? submitter : null;
}

type AttributeInput = { element: Element | null; name: string };

function attribute({ element, name }: AttributeInput): string | null {
  return element?.hasAttribute(name) ? element.getAttribute(name) : null;
}

/**
 * The submit's effective action, method, encoding and target. An empty or
 * missing action is the document's URL, as in the browser.
 */
export function submission(form: HTMLFormElement, submitter: HTMLButtonElement | HTMLInputElement | null, base: string): Submission {
  const pick = (own: string, inherited: string) =>
    attribute({ element: submitter, name: own }) ?? attribute({ element: form, name: inherited });
  const raw = pick("formaction", "action");
  let action: URL | null = null;
  try {
    action = new URL(raw === null || raw === "" ? base : raw, base);
  } catch {
    // An action no URL takes: nothing of the droplet's, so never enhanced.
    action = null;
  }
  const enctype = (pick("formenctype", "enctype") ?? "").trim().toLowerCase();
  return {
    action,
    method: (pick("formmethod", "method") ?? "").trim().toLowerCase() || "get",
    // An unknown encoding is the default one, as in the browser.
    enctype: ENCTYPES.has(enctype) || enctype === "text/plain" ? enctype : "application/x-www-form-urlencoded",
    target: (pick("formtarget", "target") ?? "").trim(),
  };
}

/** What can be enhanced: a `POST` with a body an action takes, into the page itself. */
export function interceptable(submit: Submission): boolean {
  return submit.method === "post" && ENCTYPES.has(submit.enctype) && (submit.target === "" || submit.target.toLowerCase() === "_self");
}

/** An action the form posts to: the URL without a hash, and the action's name. */
export type ActionTarget = { url: string; name: string };

/**
 * `action` when it is the droplet's own: exactly `<location>/droplets/<id>`
 * by origin and path, never a prefix of it, and no credentials. The query
 * is the action's (`?/name`, props). `null` for anything else: another
 * origin, another path, a `javascript:` or `data:` URL.
 */
export function ownAction(action: URL | null, location: string, droplet: string): ActionTarget | null {
  if (!action || (action.protocol !== "http:" && action.protocol !== "https:")) return null;
  if (action.username !== "" || action.password !== "") return null;
  let own: URL;
  try {
    own = new URL(`${location.replace(/\/+$/, "")}/droplets/${encodeURIComponent(droplet)}`);
  } catch {
    // A location that is no URL has no actions to match.
    return null;
  }
  if (action.origin !== own.origin || action.pathname !== own.pathname) return null;
  const url = new URL(action.href);
  url.hash = "";
  const named = [...url.searchParams.keys()].find((key) => key.startsWith("/"));
  return { url: url.href, name: named === undefined ? "default" : named.slice(1) };
}

/**
 * The body as the browser would encode it: `FormData` for
 * `multipart/form-data`, `URLSearchParams` otherwise (a file goes by its
 * name, as a browser sends it in a URL-encoded form).
 */
export function formBody(data: FormData, enctype: string): FormData | URLSearchParams {
  if (enctype === "multipart/form-data") return data;
  const params = new URLSearchParams();
  for (const [name, value] of data) params.append(name, typeof value === "string" ? value : value.name);
  return params;
}

const RESULT_TYPES = new Set(["success", "failure", "redirect"]);

/** An action's answer, as `enhanceDropletForm` applies it. */
export type ActionAnswer =
  | { type: "success" | "failure"; status: number; data: unknown }
  | { type: "redirect"; status: number; location: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The answer's body when it is an action's result: `{ type, status, data? }`
 * or `{ type: "redirect", status, location }`, by plain `JSON.parse`, read
 * with own keys only. `null` for anything else: an error, a body that is
 * not JSON, a shape that does not match.
 */
export function actionAnswer(body: string): ActionAnswer | null {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return null;
  }
  if (!isObject(value) || !Object.hasOwn(value, "type") || !Object.hasOwn(value, "status")) return null;
  const type = value["type"];
  const status = value["status"];
  if (typeof type !== "string" || !RESULT_TYPES.has(type) || typeof status !== "number" || !Number.isInteger(status)) {
    return null;
  }
  if (type === "redirect") {
    const location = Object.hasOwn(value, "location") ? value["location"] : undefined;
    return typeof location === "string" ? { type, status, location } : null;
  }
  return { type: type as "success" | "failure", status, data: Object.hasOwn(value, "data") ? value["data"] : undefined };
}

/**
 * Where a redirect may send the page: only what the server answers, an
 * absolute `http:` or `https:` URL without credentials, already checked
 * against its own and its trusted origins. A relative, protocol-relative
 * (`//evil.example`, `/\evil.example`) or `javascript:` location never
 * came from it, and is never followed.
 */
export function redirectTarget(location: string): string | null {
  let url: URL;
  try {
    url = new URL(location);
  } catch {
    // Not absolute: the server never answers that.
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return url.username === "" && url.password === "" ? url.href : null;
}

/** The data an answer carried, copied for the page: plain JSON, never the object the component got. */
export function plainCopy(data: unknown): unknown {
  return data === undefined ? undefined : JSON.parse(JSON.stringify(data));
}

/**
 * The nearest ancestor of `node` that matches `selector`, out through the
 * shadow roots it sits in: a form a component renders in its shadow root
 * (Lit) belongs to the droplet element around that component.
 */
type ClosestThroughInput = { node: Element; selector: string };

function closestThrough({ node, selector }: ClosestThroughInput): Element | null {
  let current: Element | null = node;
  while (current) {
    const found = current.closest(selector);
    if (found) return found;
    const root = current.getRootNode() as Node & { host?: Element };
    current = root.nodeType === 11 && root.host ? root.host : null;
  }
  return null;
}

/** The droplet element `form` belongs to: the nearest one, when the form is its own (not the host's children). */
type HostOfInput = { form: HTMLFormElement };

function hostOf({ form }: HostOfInput): DropletFormHost | null {
  const host = closestThrough({ node: form, selector: "[data-droplet]" });
  if (!host) return null;
  const candidate = host as Partial<DropletFormHost>;
  if (typeof candidate.actionTarget !== "function" || typeof candidate.updateForm !== "function") return null;
  // The host page's children, in their container: someone else's form.
  const slot = closestThrough({ node: form, selector: "[data-droplet-slot]" });
  if (slot && host.contains(slot)) return null;
  return host as DropletFormHost;
}

/** Forms with a submit in flight: another submit meanwhile is ignored. */
const inFlight = new WeakSet<HTMLFormElement>();

/**
 * One submit of `form`, enhanced when it is a `POST` to its own droplet's
 * action (and to `options.action`, when given); anything else is left to
 * the browser, untouched. For `enhanceDropletForm` and the
 * `data-droplet-enhance` attribute.
 */
export function enhanceSubmit(event: Event, form: HTMLFormElement, options: EnhanceOptions = {}): void {
  if (event.defaultPrevented) return;
  const host = hostOf({ form });
  const target = host?.actionTarget();
  if (!host || !target) return;
  const submitter = submitterOf(event, form);
  const submit = submission(form, submitter, document.baseURI);
  if (!interceptable(submit)) return;
  const action = ownAction(submit.action, target.location, target.droplet);
  if (!action || (options.action !== undefined && action.name !== options.action)) return;
  event.preventDefault();
  if (inFlight.has(form)) return;
  // Read now, as the browser would: the fields as they are at submit.
  const formData = submitter ? new FormData(form, submitter) : new FormData(form);
  let cancelled = false;
  options.onSubmit?.({ form, formData, cancel: () => void (cancelled = true) });
  if (cancelled) return;
  inFlight.add(form);
  void send({ host, droplet: target.droplet, action, body: formBody(formData, submit.enctype), options }).finally(() => {
    inFlight.delete(form);
  });
}

/**
 * Posts the form to its action, as JSON, and applies the result: by
 * `onResult`, or by default (`update()`). Then `droplets:action` tells the
 * page. An answer that is no result (an `error()`, a crash, a network
 * failure) is reported in the console and applies nothing.
 */
type SendInput = {
  host: DropletFormHost;
  droplet: string;
  action: ActionTarget;
  body: FormData | URLSearchParams;
  options: EnhanceOptions;
};

async function send({ host, droplet, action, body, options }: SendInput): Promise<void> {
  let answer: ActionAnswer | null = null;
  try {
    const response = await fetch(action.url, {
      method: "POST",
      headers: { accept: "application/json" },
      body,
      // A redirect is the action's answer, for the page: never followed here.
      redirect: "manual",
      // Credentials as the `_data` fetch sends them: the default, same-origin.
    });
    answer = actionAnswer(await response.text());
    if (!answer) console.error(`[droplets] ${droplet}: action ${action.name} answered ${response.status || response.type}, not a result`);
  } catch (error) {
    console.error(`[droplets] ${droplet}: action ${action.name} failed`, error);
  }
  if (!answer) return;

  const settled = answer;
  const detail: DropletActionDetail = {
    droplet,
    action: action.name,
    type: settled.type,
    status: settled.status,
    data: settled.type === "redirect" ? undefined : plainCopy(settled.data),
  };
  globalThis.dispatchEvent(new CustomEvent(ACTION_EVENT, { detail }));

  const update = async (): Promise<void> => {
    if (settled.type !== "redirect") return host.updateForm(settled.data);
    const location = redirectTarget(settled.location);
    if (location) globalThis.location.assign(location);
    else console.error(`[droplets] ${droplet}: action ${action.name} redirected to a URL the server never answers; not followed`);
  };
  const onResult = options.onResult as ((result: EnhanceResult) => void | Promise<void>) | undefined;
  if (!onResult) return update();
  await onResult(
    settled.type === "redirect"
      ? { type: "redirect", status: settled.status, data: undefined, location: settled.location, update }
      : { type: settled.type, status: settled.status, data: settled.data, update },
  );
}

/**
 * Enhances `form`: a submit to its own droplet's action (exactly
 * `<location>/droplets/<id>`, the hosting element's) goes by `fetch` with
 * `accept: application/json`, and the result shows in place. Any other
 * submit, and every submit once the returned function ran, is the
 * browser's. See the module documentation.
 */
export function enhanceDropletForm<A extends ActionMap = ActionMap>(form: HTMLFormElement, options?: AnyEnhanceOptions<A>): () => void;
export function enhanceDropletForm<A extends ActionMap = ActionMap>(form: HTMLFormElement, options: ActionEnhanceOptions<A>): () => void;
/** Untyped options as a wrapper forwards them: any action, any `data`. */
export function enhanceDropletForm(form: HTMLFormElement, options?: EnhanceOptions): () => void;
export function enhanceDropletForm(form: HTMLFormElement, options?: EnhanceOptions): () => void {
  const listener = (event: Event) => enhanceSubmit(event, form, options);
  form.addEventListener("submit", listener);
  return () => form.removeEventListener("submit", listener);
}
