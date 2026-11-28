/**
 * The messages of the droplets server at runtime: the app, the SSR bundle,
 * loads, actions, cookies and `$droplets/server`. Warnings here reach only
 * `vite dev` and the build's prerender, through `devLog`.
 *
 * @module
 */
import type { FormResultDropReason } from "../runtime/form-token.server.ts";
import type { AnyMessage, ErrorPages } from "./format.ts";

const BUG = "this is a bug in Droplets: report it at https://github.com/dropletsjs/droplets/issues with the steps that lead here";

export const REQUEST_FAILED = {
  code: "request-failed",
  level: "error",
  what: ({ where, path, reason }: { where: string; path: string; reason: string }) =>
    `${where} failed: ${path}${reason ? ` (${reason})` : ""}; the error follows`,
  fix: "read the error logged after this message; the request answered 500 through handleError in hooks.server.ts",
} satisfies AnyMessage;

export const DROPLET_LOAD_FAILED = {
  code: "droplet-load-failed",
  level: "error",
  what: "the droplet's load failed; the error follows",
  fix: "read the error logged after this message; the droplet renders its +error page with what handleError returns",
} satisfies AnyMessage;

export const ERROR_PAGE_MISSING = {
  code: "error-page-missing",
  level: "error",
  what: "load failed and there is no error page (+error.*)",
  fix: "add +error.<ext> to the droplet's folder, in its framework, or handle the failure inside the load",
} satisfies AnyMessage;

export const HANDLE_ERROR_THREW = {
  code: "handle-error-threw",
  level: "error",
  what: "handleError threw",
  fix: "make handleError return { error } without throwing; what it threw is the error's cause",
} satisfies AnyMessage;

export const HANDLE_ERROR_RESULT_INVALID = {
  code: "handle-error-result-invalid",
  level: "error",
  what: "handleError must return { error }",
  fix: "return { error } from handleError, with the error the +error page shows",
} satisfies AnyMessage;

export const LOAD_RETURNED_RESPONSE = {
  code: "load-returned-response",
  level: "error",
  what: "load returned a Response; a load returns a plain object",
  fix: "return the data as an object from load; json() and text() are for +server.ts",
} satisfies AnyMessage;

export const LOAD_RESULT_NOT_OBJECT = {
  code: "load-result-not-object",
  level: "error",
  what: "load must return a plain object",
  fix: "return an object literal from load, e.g. return { … }, or nothing",
} satisfies AnyMessage;

export const PROPS_SCHEMA_INVALID = {
  code: "props-schema-invalid",
  level: "error",
  what: "`props` in +droplet.ts must be a Standard Schema (zod, valibot, arktype…)",
  fix: "export a schema of a Standard Schema library as props, e.g. export const props = z.object({ … })",
} satisfies AnyMessage;

export const PROPS_SCHEMA_NOT_OBJECT = {
  code: "props-schema-not-object",
  level: "error",
  what: "the props schema must produce an object",
  fix: "make props an object schema, e.g. z.object({ page: z.coerce.number() })",
} satisfies AnyMessage;

export const SET_HEADERS_NOT_OBJECT = {
  code: "set-headers-not-object",
  level: "error",
  what: "setHeaders takes an object of header names and string values",
  fix: 'call it with an object, e.g. setHeaders({ "cache-control": "max-age=60" })',
} satisfies AnyMessage;

export const SET_HEADERS_NAME_INVALID = {
  code: "set-headers-name-invalid",
  level: "error",
  what: ({ name }: { name: string }) => `setHeaders: ${JSON.stringify(name)} is not a header name`,
  fix: "name the header with letters, digits and !#$%&'*+-.^_`|~ only",
} satisfies AnyMessage;

export const SET_HEADERS_VALUE_INVALID = {
  code: "set-headers-value-invalid",
  level: "error",
  what: ({ name }: { name: string }) => `setHeaders: the value of ${name} must be a string without line breaks`,
  fix: "pass the header's value as a string on one line",
} satisfies AnyMessage;

export const SET_HEADERS_SET_COOKIE = {
  code: "set-headers-set-cookie",
  level: "error",
  what: "setHeaders cannot set set-cookie",
  fix: "set cookies in form actions, handle or +server.ts, with event.cookies",
} satisfies AnyMessage;

export const SET_HEADERS_DUPLICATE = {
  code: "set-headers-duplicate",
  level: "error",
  what: ({ name }: { name: string }) => `setHeaders: ${name} is already set`,
  fix: "set each header once per request: merge the values in one call",
} satisfies AnyMessage;

export const RENDERER_MISSING = {
  code: "renderer-missing",
  level: "error",
  what: ({ kind }: { kind: string }) => `the ${kind} component has no renderer; the server registry is stale`,
  fix: "restart vite dev or run vite build again, so the server bundle knows the droplet's renderer",
} satisfies AnyMessage;

export const RENDERER_OUTPUT_INVALID = {
  code: "renderer-output-invalid",
  level: "error",
  what: "the renderer must return HTML as a string or { html, head }",
  fix: "return a string or { html, head } from the renderer's render()",
} satisfies AnyMessage;

export const ENTRIES_NOT_ARRAY = {
  code: "entries-not-array",
  level: "error",
  what: "entries() must return an array of events",
  fix: "return an array from entries(), e.g. [{ props: { page: 1 } }]",
} satisfies AnyMessage;

export const ENTRY_SHAPE_INVALID = {
  code: "entry-shape-invalid",
  level: "error",
  what: ({ entry }: { entry: string }) => `entries() returns events, { props?, host?, file? }; got ${entry}`,
  fix: "put props under props: [{ props: { page: 1 } }]",
} satisfies AnyMessage;

export const ENTRY_PROPS_NOT_OBJECT = {
  code: "entry-props-not-object",
  level: "error",
  what: ({ props }: { props: string }) => `an entry's props must be an object, got ${props}`,
  fix: "give an entry's props as an object, e.g. { props: { page: 1 } }",
} satisfies AnyMessage;

export const ENTRY_HOST_INVALID = {
  code: "entry-host-invalid",
  level: "error",
  what: ({ host }: { host: string }) => `an entry's host must be an absolute URL, got ${JSON.stringify(host)}`,
  fix: "give host as an absolute http(s) URL, e.g. https://shop.example/blog",
} satisfies AnyMessage;

export const ENTRY_FILE_INVALID = {
  code: "entry-file-invalid",
  level: "error",
  what: ({ file }: { file: string }) => `an entry's file is a lowercase kebab-case name, got ${file}`,
  fix: 'name the file like "page-2": lowercase letters, digits and single hyphens',
} satisfies AnyMessage;

export const ENTRY_FILE_DUPLICATE = {
  code: "entry-file-duplicate",
  level: "error",
  what: ({ file }: { file: string }) => `two entries name the file "${file}"`,
  fix: "give each entry its own file",
} satisfies AnyMessage;

export const TRANSFORM_RESULT_NOT_STRING = {
  code: "transform-result-not-string",
  level: "error",
  what: "transform must return the HTML as a string",
  fix: "return the HTML string from every transform step",
} satisfies AnyMessage;

export const ACTIONS_NOT_OBJECT = {
  code: "actions-not-object",
  level: "error",
  what: "actions in +droplet.server.ts must be a plain object of functions",
  fix: "export const actions = { default, add, … }",
} satisfies AnyMessage;

export const PAYLOAD_NOT_SERIALIZABLE = {
  code: "payload-not-serializable",
  level: "error",
  what: ({ what, path, reason }: { what: string; path: string; reason: string }) =>
    `the ${what} cannot travel to the browser: ${path} is ${reason}`,
  fix: "send plain JSON (object literals, arrays, strings, finite numbers, booleans, null) and Date, Map, Set, URL or BigInt values; await promises in the load, and turn class instances into object literals",
} satisfies AnyMessage;

export const ACTION_FAILED = {
  code: "action-failed",
  level: "error",
  what: ({ path }: { path: string }) => `form action failed: ${path}; the error follows`,
  fix: "read the error logged after this message; the request answered 500 through handleError in hooks.server.ts",
} satisfies AnyMessage;

export const ACTION_NAME_INVALID = {
  code: "action-name-invalid",
  level: "error",
  what: ({ name }: { name: string }) => `${JSON.stringify(name.slice(0, 100))} is not an action name`,
  fix: 'name an action of +droplet.server.ts, e.g. actionUrl("add"): letters, digits, "-" and "_"',
} satisfies AnyMessage;

export const REDIRECT_OFF_SITE = {
  code: "redirect-off-site",
  level: "error",
  what: ({ label, target, path }: { label: string; target: string; path: string }) =>
    `${label} redirects to ${JSON.stringify(target.slice(0, 200))}, which is not on this server or a trusted origin; answered 400${path ? `: ${path}` : ""}`,
  fix: "redirect to this server, to host or to an origin listed in trustedOrigins (or DROPLETS_TRUSTED_ORIGINS)",
} satisfies AnyMessage;

export const HOOK_HANDLE_ERROR_LOAD_FAILED = {
  code: "hook-handle-error-load-failed",
  level: "error",
  what: "loading handleError from hooks.server.ts failed; the error follows",
  fix: 'fix the error logged after this message in src/hooks.server.ts; the request answered "Internal Server Error"',
} satisfies AnyMessage;

export const HOOK_HANDLE_ERROR_THREW = {
  code: "hook-handle-error-threw",
  level: "error",
  what: "handleError in hooks.server.ts threw; the error follows",
  fix: 'make handleError return { message } without throwing; the request answered "Internal Server Error"',
} satisfies AnyMessage;

export const HANDLE_RESULT_NOT_RESPONSE = {
  code: "handle-result-not-response",
  level: "error",
  what: "handle in hooks.server.ts must return a Response",
  fix: "return the Response of resolve(event), or one of your own",
} satisfies AnyMessage;

export const IMPORT_MAP_INVALID = {
  code: "import-map-invalid",
  level: "error",
  what: "importmap must return an import map",
  fix: "return { imports: { … } } from importmap in src/importmap.server.ts",
} satisfies AnyMessage;

export const ENDPOINT_RESULT_NOT_RESPONSE = {
  code: "endpoint-result-not-response",
  level: "error",
  what: ({ route, method }: { route: string; method: string }) => `${route} ${method} must return a Response`,
  fix: "return a Response from the handler, e.g. json(data) or text(body) from $droplets/server",
} satisfies AnyMessage;

export const EVENT_FETCH_TOO_DEEP = {
  code: "event-fetch-too-deep",
  level: "error",
  what: ({ url, depth, limit }: { url: string; depth: number; limit: number }) =>
    `event.fetch(${JSON.stringify(url.slice(0, 200))}) would be ${depth} internal requests deep (the limit is ${limit}): a request is fetching itself`,
  fix: "call the code the route runs instead of fetching the route",
} satisfies AnyMessage;

export const ERROR_STATUS_INVALID = {
  code: "error-status-invalid",
  level: "error",
  what: ({ status }: { status: number }) => `error() needs a status between 400 and 599, got ${status}`,
  fix: 'pass a 4xx or 5xx status, e.g. error(404, "Not found")',
} satisfies AnyMessage;

export const REDIRECT_STATUS_INVALID = {
  code: "redirect-status-invalid",
  level: "error",
  what: ({ status }: { status: number }) => `redirect() needs a status between 300 and 308, got ${status}`,
  fix: 'pass 300 to 308, e.g. redirect(303, "/thanks")',
} satisfies AnyMessage;

export const REDIRECT_TARGET_INVALID = {
  code: "redirect-target-invalid",
  level: "error",
  what: ({ target }: { target: string }) =>
    `redirect() needs an http(s) URL or a path on this site, got ${JSON.stringify(target.slice(0, 200))}`,
  fix: 'pass a path such as "/cart" or an absolute http(s) URL',
} satisfies AnyMessage;

export const FAIL_STATUS_INVALID = {
  code: "fail-status-invalid",
  level: "error",
  what: ({ status }: { status: number }) => `fail() needs a status between 400 and 599, got ${status}`,
  fix: "pass a 4xx or 5xx status, e.g. fail(400, { missing: true })",
} satisfies AnyMessage;

export const HOST_UNKNOWN_IN_PRERENDER = {
  code: "host-unknown-in-prerender",
  level: "error",
  what: ({ property, entry }: { property: string; entry: string }) =>
    `host.${property} is not known while prerendering entry ${entry}; only host.origin, host.pathname and host.href are`,
  fix: "give `host` in the entry or in droplets.config.ts, or render the droplet live",
} satisfies AnyMessage;

export const COOKIES_IN_PRERENDER = {
  code: "cookies-in-prerender",
  level: "error",
  what: ({ where, method }: { where: string; method: string }) =>
    `${where}: cookies.${method}() is not available while prerendering: there is no request at build`,
  fix: "in handle, skip it when `building` from $droplets/env is true; in a droplet, render it live",
} satisfies AnyMessage;

export const COOKIES_READ_ONLY = {
  code: "cookies-read-only",
  level: "error",
  what: ({ method }: { method: string }) => `cookies.${method}() is not available in a droplet's load or transform: cookies are read there`,
  fix: "set cookies in form actions, handle or +server.ts",
} satisfies AnyMessage;

export const COOKIE_NAME_INVALID = {
  code: "cookie-name-invalid",
  level: "error",
  what: ({ name }: { name: string }) => `cookie name ${JSON.stringify(name)} is not a valid token`,
  fix: "name the cookie with letters, digits and !#$%&'*+-.^_`|~ only",
} satisfies AnyMessage;

export const COOKIE_VALUE_INVALID = {
  code: "cookie-value-invalid",
  level: "error",
  what: ({ name }: { name: string }) => `cookie ${name}: the encoded value has characters a cookie cannot carry`,
  fix: "keep the default encode (encodeURIComponent), or make your encode return only cookie-safe characters",
} satisfies AnyMessage;

export const COOKIE_MAX_AGE_INVALID = {
  code: "cookie-max-age-invalid",
  level: "error",
  what: ({ name }: { name: string }) => `cookie ${name}: maxAge must be a number of seconds`,
  fix: "pass maxAge as a finite number of seconds, e.g. 60 * 60 * 24",
} satisfies AnyMessage;

export const COOKIE_DOMAIN_INVALID = {
  code: "cookie-domain-invalid",
  level: "error",
  what: ({ name }: { name: string }) => `cookie ${name}: invalid domain`,
  fix: "pass a domain without spaces, semicolons or control characters, e.g. shop.example",
} satisfies AnyMessage;

export const COOKIE_PATH_INVALID = {
  code: "cookie-path-invalid",
  level: "error",
  what: ({ name }: { name: string }) => `cookie ${name}: invalid path`,
  fix: 'pass a path without spaces, semicolons or control characters, e.g. "/"',
} satisfies AnyMessage;

export const COOKIE_SAME_SITE_INVALID = {
  code: "cookie-same-site-invalid",
  level: "error",
  what: ({ name }: { name: string }) => `cookie ${name}: sameSite must be "lax", "strict" or "none"`,
  fix: 'pass sameSite: "lax", "strict", "none" or true',
} satisfies AnyMessage;

export const COOKIE_SAME_SITE_NONE_INSECURE = {
  code: "cookie-same-site-none-insecure",
  level: "error",
  what: ({ name }: { name: string }) => `cookie ${name}: sameSite "none" needs secure: true`,
  fix: 'add secure: true, or use sameSite: "lax"',
} satisfies AnyMessage;

export const COOKIE_PATH_MISSING = {
  code: "cookie-path-missing",
  level: "error",
  what: "you must specify a `path` when setting, deleting or serializing cookies",
  fix: 'pass path, e.g. cookies.set("cart", id, { path: "/" })',
} satisfies AnyMessage;

export const COOKIE_PATH_NOT_ABSOLUTE = {
  code: "cookie-path-not-absolute",
  level: "error",
  what: ({ path }: { path: string }) => `cookie path must be absolute ("/" or "/admin"), got ${JSON.stringify(path)}`,
  fix: 'start the path with "/"',
} satisfies AnyMessage;

export const DROPLET_MIDDLEWARE_MISSING = {
  code: "droplet-middleware-missing",
  level: "error",
  what: "a droplet route ran without the droplet middleware",
  fix: BUG,
} satisfies AnyMessage;

export const FORM_PAGE_WITHOUT_ORIGIN = {
  code: "form-page-without-origin",
  level: "error",
  what: "the page a form goes back to has no origin",
  fix: BUG,
} satisfies AnyMessage;

export const SSR_BUNDLE_WITHOUT_RENDER = {
  code: "ssr-bundle-without-render",
  level: "error",
  what: "the SSR bundle does not export renderDroplet",
  fix: "run vite build again with the same version of @dropletsjs/droplets as the adapter",
} satisfies AnyMessage;

export const LOCATION_UNTRUSTED = {
  code: "location-untrusted",
  level: "warning",
  what: ({ location, source }: { location: string; source: string }) =>
    `ignoring the location ${JSON.stringify(location.slice(0, 200))} from ${source}: its origin is not this server's and not trusted`,
  fix: "list the origin in trustedOrigins in droplets.config.ts (or DROPLETS_TRUSTED_ORIGINS), or set location",
} satisfies AnyMessage;

export const ANY_LOCATION_TRUSTED = {
  code: "any-location-trusted",
  level: "warning",
  what: ({ option }: { option: string }) => `${option}: "*" trusts any forwarded location`,
  fix: "list the hosts' origins instead, unless every request reaches this server through a proxy you control",
} satisfies AnyMessage;

export const TRUSTED_ORIGIN_ENV_INVALID = {
  code: "trusted-origin-env-invalid",
  level: "warning",
  what: ({ variable, entry }: { variable: string; entry: string }) =>
    `${variable}: ignoring ${JSON.stringify(entry)}, not an origin such as https://shop.example`,
  fix: "list origins separated by commas, each a scheme and a host without a path, e.g. https://shop.example,https://blog.example",
} satisfies AnyMessage;

export const FORM_SECRET_MISSING = {
  code: "form-secret-missing",
  level: "warning",
  what: "DROPLETS_SECRET is not set: a form posted without JavaScript gets the droplet's fragment instead of a redirect back to the page (Post/Redirect/Get)",
  fix: "set DROPLETS_SECRET to 32 or more random bytes, e.g. the output of `openssl rand -base64 32`",
} satisfies AnyMessage;

export const FORM_SECRET_SHORT = {
  code: "form-secret-short",
  level: "warning",
  what: ({ minBytes }: { minBytes: number }) =>
    `DROPLETS_SECRET is shorter than ${minBytes} bytes and is ignored: forms posted without JavaScript get the droplet's fragment instead of a redirect back to the page`,
  fix: ({ minBytes }: { minBytes: number }) =>
    `set DROPLETS_SECRET to ${minBytes} or more random bytes, e.g. the output of \`openssl rand -base64 32\``,
} satisfies AnyMessage;

export const CORS_ANY_ORIGIN = {
  code: "cors-any-origin",
  level: "warning",
  what: "cors allows every origin: Access-Control-Allow-Origin: * on every route (/api/*, _data, /index.js included)",
  fix: "list the hosts' origins instead ({ origin: [...] }) for anything not public",
} satisfies AnyMessage;

export const PROPS_HEADER_MALFORMED = {
  code: "props-header-malformed",
  level: "warning",
  what: "ignoring malformed x-droplet-props header",
  fix: "send x-droplet-props as base64 of a JSON object, or the props in the query",
} satisfies AnyMessage;

export const ENV_MAX_AGE_INVALID = {
  code: "env-max-age-invalid",
  level: "warning",
  what: ({ value, fallback }: { value: string; fallback: string }) =>
    `DROPLETS_ENV_MAX_AGE: ignoring ${JSON.stringify(value.slice(0, 200))}, not a whole number of seconds (0 or more); /env.js is sent with ${fallback}`,
  fix: "set DROPLETS_ENV_MAX_AGE to a whole number of seconds, 0 for no-store",
} satisfies AnyMessage;

export const FORM_RESULT_TOO_LARGE = {
  code: "form-result-too-large",
  level: "warning",
  what: ({ action }: { action: string }) =>
    `the result of action ${action} is over 2 KB as a URL value; it goes back to the page without its data (status and action only)`,
  fix: "return less from the action: field names and messages",
} satisfies AnyMessage;

type FormResultDroppedParams = { reason: FormResultDropReason; action?: string | undefined };

function dropReasonOf({ reason, action }: FormResultDroppedParams): string {
  switch (reason) {
    case "malformed":
      return "the value in the page's URL is not a signed result";
    case "signature":
      return "its signature does not match this droplet, build and page: changed, sent back to another page, or signed with another DROPLETS_SECRET";
    case "expired":
      return "it expired: a result lasts 5 minutes";
    case "ahead":
      return "it is dated ahead of this server's clock by more than a minute";
    case "invalid":
      return "its contents are not a result an action returns";
    case "no-page":
      return "host is not a URL, so the page the result is bound to is unknown";
    case "no-secret":
      return "DROPLETS_SECRET is not set or too short";
    case "action-missing":
      return `the droplet exports no action ${action}`;
    case "action-unavailable":
      return `action ${action} could not be looked up`;
    default: {
      const unreachable: never = reason;
      return unreachable;
    }
  }
}

export const FORM_RESULT_DROPPED = {
  code: "form-result-dropped",
  level: "warning",
  what: (params: FormResultDroppedParams) => `a form result was dropped (${dropReasonOf(params)}); the droplet rendered without \`form\``,
  fix: "post the form again from the page: a result holds for 5 minutes, on the page, droplet and build it was sent back to, under one DROPLETS_SECRET on every server",
} satisfies AnyMessage;

export const FORM_RESULT_NOT_PLAIN = {
  code: "form-result-not-plain",
  level: "warning",
  what: ({ way }: { way: string }) =>
    `an action's result holds a Date, Map, Set, URL or BigInt, which ${way} cannot carry (plain JSON only): it went without the result`,
  fix: "return plain JSON from an action whose result goes back to the server (a date as an ISO string, say); a hydrated droplet's enhanced form gets every type",
} satisfies AnyMessage;

export const RENDER_TIMED_OUT = {
  code: "render-timed-out",
  level: "warning",
  what: ({ timeout }: { timeout: number }) => `answered 504 after render.timeout (${timeout} ms), its loads or render still running`,
  fix: "pass event.request.signal to what the load waits on, make it faster, or raise render.timeout in droplets.config.ts",
} satisfies AnyMessage;

export const RUNTIME_PAGES: ErrorPages = {
  "request-failed": {
    when: "A fragment, _data, action, endpoint or other request threw something that is not error() or redirect(), in production as under vite dev.",
    see: "/guides/errors/",
  },
  "droplet-load-failed": {
    when: "On the server, when a droplet's load in +droplet.server.ts throws or rejects, in production as under vite dev and the prerender.",
    see: "/guides/errors/",
  },
  "error-page-missing": {
    when: "On the server, when a droplet's load fails and the droplet has no +error page to show it: the request answers 500.",
    see: "/guides/errors/",
  },
  "handle-error-threw": {
    when: "On the server, when the handleError of +droplet.server.ts or +droplet.ts throws while turning a load's error into the one its +error page shows.",
    see: "/guides/errors/",
  },
  "handle-error-result-invalid": {
    when: "On the server or in the browser, when a droplet's handleError returns something other than an object with an error field.",
    see: "/guides/errors/",
  },
  "load-returned-response": {
    when: "On the server or in the browser, when a droplet's load returns a Response, such as json() or text().",
  },
  "load-result-not-object": {
    when: "On the server or in the browser, when a droplet's load returns something other than an object literal, null or undefined.",
  },
  "props-schema-invalid": {
    when: "On the server or in the browser, when +droplet.ts exports props that is not a Standard Schema.",
  },
  "props-schema-not-object": {
    when: "On the server or in the browser, when the props schema of +droplet.ts validates to something other than an object.",
  },
  "set-headers-not-object": { when: "On the server, when a droplet's load calls setHeaders with something other than an object." },
  "set-headers-name-invalid": { when: "On the server, when a droplet's load calls setHeaders with a name no HTTP header can have." },
  "set-headers-value-invalid": {
    when: "On the server, when a droplet's load calls setHeaders with a value that is not a string, or holds a line break.",
  },
  "set-headers-set-cookie": { when: "On the server, when a droplet's load calls setHeaders with set-cookie." },
  "set-headers-duplicate": { when: "On the server, when a droplet's load sets the same header twice in one request." },
  "renderer-missing": {
    when: "On the server, when the SSR bundle meets a droplet whose renderer it does not hold, after a change it has not been rebuilt for.",
  },
  "renderer-output-invalid": { when: "On the server, when a renderer's render() returns neither a string nor { html, head }." },
  "entries-not-array": {
    when: "In vite build, when a prerendered droplet's entries() in +droplet.server.ts returns something other than an array.",
  },
  "entry-shape-invalid": {
    when: "In vite build, when an event that entries() returns has keys other than props, host and file.",
    see: "/guides/prerendering/",
  },
  "entry-props-not-object": { when: "In vite build, when an entry's props is not an object.", see: "/guides/prerendering/" },
  "entry-host-invalid": { when: "In vite build, when an entry's host is not an absolute http(s) URL.", see: "/guides/prerendering/" },
  "entry-file-invalid": { when: "In vite build, when an entry's file is not a lowercase kebab-case name.", see: "/guides/prerendering/" },
  "entry-file-duplicate": { when: "In vite build, when two entries of one droplet name the same file.", see: "/guides/prerendering/" },
  "transform-result-not-string": {
    when: "On the server or in vite build, when a step of a droplet's transform returns something other than a string.",
  },
  "actions-not-object": {
    when: "On the server, when a form posts to a droplet whose +droplet.server.ts exports actions that is not a plain object.",
    see: "/guides/actions/",
  },
  "payload-not-serializable": {
    when: "On the server and in vite build, when a droplet's server data or a form action's result holds a value that cannot travel to the browser: the droplet renders its +error page, and an action answers 500.",
    see: "/guides/writing-droplets/#what-data-can-be",
  },
  "action-failed": {
    when: "On the server, when a form action returned data that cannot travel to the browser; the error logged after it says which.",
    see: "/guides/actions/",
  },
  "action-name-invalid": {
    when: "On the server or in the browser, when actionUrl() is called with a name that no action can have.",
    see: "/guides/actions/",
  },
  "redirect-off-site": {
    when: "On the server, when a load, transform, handle, a form action or a +server route redirects to an origin that is not this server's, the location's, host or a trusted origin: the request answers 400.",
    see: "/guides/security/",
  },
  "hook-handle-error-load-failed": {
    when: "On the server, when src/hooks.server.ts fails to load while an unexpected error is being answered.",
    see: "/guides/server/",
  },
  "hook-handle-error-threw": {
    when: "On the server, when handleError in src/hooks.server.ts throws while an unexpected error is being answered.",
    see: "/guides/server/",
  },
  "import-map-invalid": {
    when: "On the server, when importmap in src/importmap.server.ts returns something other than an object.",
    see: "/guides/import-maps/",
  },
  "handle-result-not-response": { when: "On the server, when handle in src/hooks.server.ts returns something other than a Response." },
  "endpoint-result-not-response": { when: "On the server, when a handler of a +server.ts route returns something other than a Response." },
  "event-fetch-too-deep": {
    when: "On the server, when event.fetch to this server nests more internal requests than the limit: a route fetching itself.",
  },
  "error-status-invalid": { when: "When error() from $droplets/server is called with a status outside 400 to 599." },
  "redirect-status-invalid": { when: "When redirect() from $droplets/server is called with a status outside 300 to 308." },
  "redirect-target-invalid": {
    when: "When redirect() from $droplets/server is called with a target that is neither an http(s) URL nor a path on this site.",
  },
  "fail-status-invalid": { when: "When fail() from $droplets/server is called with a status outside 400 to 599." },
  "host-unknown-in-prerender": {
    when: "In vite build, when a prerendered droplet reads a field of host other than origin, pathname and href, and no host is known for the entry. It stops the build.",
    see: "/guides/prerendering/",
  },
  "cookies-in-prerender": {
    when: "In vite build, when handle or a prerendered droplet uses event.cookies: a build-time render has no request. It stops the build.",
    see: "/guides/prerendering/",
  },
  "cookies-read-only": {
    when: "On the server, when a droplet's load or transform calls cookies.set, delete or serialize: cookies are only read there.",
  },
  "cookie-name-invalid": { when: "On the server, when cookies.set or serialize gets a name a cookie cannot have." },
  "cookie-value-invalid": {
    when: "On the server, when the encoded value of cookies.set or serialize holds characters a cookie cannot carry.",
  },
  "cookie-max-age-invalid": { when: "On the server, when cookies.set or serialize gets a maxAge that is not a finite number." },
  "cookie-domain-invalid": { when: "On the server, when cookies.set or serialize gets a domain a cookie attribute cannot carry." },
  "cookie-path-invalid": { when: "On the server, when cookies.set or serialize gets a path a cookie attribute cannot carry." },
  "cookie-same-site-invalid": {
    when: "On the server, when cookies.set or serialize gets a sameSite other than lax, strict, none or true.",
  },
  "cookie-same-site-none-insecure": { when: 'On the server, when cookies.set or serialize gets sameSite "none" without secure: true.' },
  "cookie-path-missing": { when: "On the server, when cookies.set, delete or serialize is called without a path." },
  "cookie-path-not-absolute": { when: 'On the server, when cookies.set, delete or serialize gets a path that does not start with "/".' },
  "droplet-middleware-missing": { when: "On the server, when a route that needs the droplet middleware runs without it. It never should." },
  "form-page-without-origin": {
    when: "On the server, when a form posted without JavaScript goes back to a page without an origin. It never should.",
  },
  "ssr-bundle-without-render": {
    when: "When the production server, or rendererConformance() of @dropletsjs/droplets/testing, loads an SSR bundle that exports no renderDroplet: a bundle from another build or version.",
    see: "/guides/deployment/",
  },
  "location-untrusted": {
    when: "Under vite dev and the build's prerender, once per header, when a request's x-droplet-location, Forwarded or X-Forwarded-* header names an origin that is not trusted.",
    see: "/guides/security/",
  },
  "any-location-trusted": {
    when: 'Under vite dev and the build\'s prerender, when trustedOrigins or DROPLETS_TRUSTED_ORIGINS holds "*".',
    see: "/guides/security/#trusting-any-location",
  },
  "trusted-origin-env-invalid": {
    when: "Under vite dev and the build's prerender, when an entry of DROPLETS_TRUSTED_ORIGINS is not an origin.",
    see: "/guides/security/",
  },
  "form-secret-missing": {
    when: "Under vite dev and the build's prerender, once, when a form is posted and DROPLETS_SECRET is not set.",
    see: "/guides/actions/",
  },
  "form-secret-short": {
    when: "Under vite dev and the build's prerender, once, when DROPLETS_SECRET is shorter than the minimum.",
    see: "/guides/actions/",
  },
  "cors-any-origin": {
    when: 'Under vite dev and the build\'s prerender, once, when cors is true or allows the origin "*".',
    see: "/guides/security/",
  },
  "props-header-malformed": {
    when: "Under vite dev and the build's prerender, when a request's x-droplet-props header is not base64 of a JSON object.",
  },
  "env-max-age-invalid": {
    when: "Under vite dev and the build's prerender, when DROPLETS_ENV_MAX_AGE is not a whole number of seconds.",
    see: "/guides/configuration/",
  },
  "form-result-too-large": {
    when: "Under vite dev, when a form posted without JavaScript gets back an action result over 2 KB as a URL value.",
    see: "/guides/actions/",
  },
  "form-result-dropped": {
    when: "Under vite dev, when the page a form posted without JavaScript went back to carries a result for the droplet that is not genuine, has expired, or names an action the droplet does not export. The droplet renders without form.",
    see: "/guides/actions/",
  },
  "form-result-not-plain": {
    when: "Under vite dev, when an action's result holds a Date, Map, Set, URL or BigInt and has to go back to the server: in the signed result of a form posted without JavaScript, or in the render of a droplet that does not hydrate after an enhanced form.",
    see: "/guides/actions/",
  },
  "render-timed-out": {
    when: "Under vite dev, every time a fragment or _data request answers 504 because its loads and render passed render.timeout.",
    see: "/guides/configuration/",
  },
};
