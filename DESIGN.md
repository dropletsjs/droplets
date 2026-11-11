# Design notes

**This is a log of decisions, not a spec: what ships is what the guides describe, and an item marked pending is not a promise for 1.0.**

How to read this: each section is one design decision, recorded as it was taken, with its reasons and how much of it is built.
What ships is described by the guides at https://dropletsjs.dev; where the two differ, the guides are right.

## The droplet location: `x-droplet-location` and the forwarded headers (built 2026-11-11)

- The request header that names the droplets server's public location is
  `x-droplet-location`. Naming rule: request headers singular
  (`x-droplet-*`), response headers plural (`x-droplets-*`).
- One location per request, the first candidate that parses and is
  trusted: `x-droplet-location`; the first element of `Forwarded`; the first
  `X-Forwarded-Proto` + `X-Forwarded-Host` (+ `X-Forwarded-Port`); else the
  request's own origin. The forwarded ones take the prefix from
  `X-Forwarded-Prefix`. First values, because later proxies append.
- Trust: a header's origin must be the request's own or in
  `trustedOrigins` / `DROPLETS_TRUSTED_ORIGINS`. One list for both jobs
  (form posts and location headers): a proxy's public origin is where the
  host pages are too. With the allow-list, reading the forwarded headers is
  safe and a plain reverse proxy needs no custom header.
- `"*"` in `trustedOrigins` trusts any location: the owner's call, documented
  ("Trusting any location") and warned about once at start, never refused.
  The general rule: give the owner the knobs and the advice, don't enforce.
- A prefix starts with `/`, has no `//`, `\`, `..`, `?`, `#` or control
  characters, is at most 256 characters, and keeps the origin when joined;
  otherwise it is dropped (URL hygiene, applied with `"*"` too).
- `event.host` does not read the forwarded headers: body `host`, `Origin`,
  then the location's origin.
- `Vary` lists the location headers, but CDNs ignore `Vary` on custom
  headers: the allow-list is the guard.

## `location` and `host`: computed per request, or fixed at build (built 2026-11-11)

- Without `location`, the location is computed per request (above). With
  it, a build writes it into the server bundle and every request's location
  is that value: no location header is read, and `Vary` keeps `origin` alone.
  One build serves one location.
- Without `host`, `event.host` comes from the request. With it, `event.host`
  is that origin, plus the reported page's path and query only when the page
  is on it; `Origin` is no fallback. It joins the origin check and the
  redirect allow-list, never location trust.
- Prerendering renders an entry without its own `host` for `host` of the
  config, stored under the origin alone.
- With both set, nothing is per request: no token in the bundle or the
  renders, no rewrite of any answer, and the replacing code
  (`runtime/host-tokens.ts`) is not bundled. It reaches the app only through
  `virtual:droplets-config`, as an internal option.
- `vite dev` ignores both and computes them per request.

## `dev.strategy: "hmr"`: the framework's own HMR, never a reload (built 2026-11-11)

The host's page is not ours, so a dev edit must never reload it. `hmr` is
the new default; `remount`, `reload` and `manual` stay as they were, and
`index.js?strategy=` takes `hmr` too.

- **Classifying an edit.** The plugin's `hotUpdate` runs once per edit (the
  client environment, which Vite runs first) and sends one
  `droplets:update` per droplet, with `kind`. It is `contract` when the
  registry's `ssr` / `hydrate` / `prerender` differ from before the edit,
  carrying `before` and `after`. It is `load` for `+droplet.server.ts`,
  `+droplet.ts`, a server-only file, or a module only they reach. Anything
  else is `component`. The payloads are plain data; the page reads them with
  `Object.hasOwn`, known droplet ids only, and only from the server that
  served its `index.js`.
- **Component edits** stay with Vite and the framework: React Fast Refresh,
  Prefresh (compiled in the Preact renderer's own transform, never Vite's
  shared `oxc` options), plugin-vue, vite-plugin-svelte and solid-refresh.
  Each droplet's client module accepts its component and error page as the
  last boundary. An update that no framework module takes stops there
  instead of becoming a full reload. The client module then dispatches
  `droplets:hot-fallback`, and the element remounts in place: Lit, Hono JSX,
  Handlebars, script droplets, or a Fast Refresh that gives up. A Svelte
  module accepts its `default` export only, so its update reaches the
  client module too. The loader drops that second update when the module
  took the edit itself (`vite:beforeUpdate`).
- **Load edits** run the loads again (`_data`, then `+droplet.ts`) and hand
  the result to an optional renderer hook, `update(instance, props)`, in the
  renderer's `clientDev` module. The plugin imports that module only under
  `vite dev` and in builds that are not for production (vitest's), so a
  production build never carries it. The instance keeps its state; without
  the hook the element remounts. Every framework renderer in the repo has
  one; a script droplet runs its cleanup and its function again.
- **Contract edits** leave the droplet as it is. `contractNotice` and
  `hydrateAction` in `runtime/dev-contract.ts` are the decision table: a
  notice per change, **Reload page** for `ssr` → true and `hydrate` → false,
  and a live hydrate for `hydrate` turning on. Between hydrate modes, an
  element still waiting waits in the new mode and a hydrated one only gets a
  console line. `prerender` points to `vite preview`.
- **Notices** go to `DropletsDevTools.notify` when the dev tool is on the
  page. Otherwise they go to a small toast stack of core's own, in a shadow
  root (`<droplets-dev-notifications>`). A notice with a button is an
  `alertdialog`, one without is a `status`. Each can be dismissed, at most
  three show, and a repeat replaces the earlier one by key (droplet and
  flags). Each also writes one console line. A `hooks.client.ts` edit is
  such a notice too, instead of the old full reload.
- **Other strategies** keep working by dropping Vite's module updates for
  a held edit in `vite:beforeUpdate` (stylesheets aside). The element then
  follows `droplets:update` as before.
- **Kept out of a build:** all of it lives in `runtime/dev-element.ts`. The
  entry installs it on the element's prototype with one
  `if (import.meta.env.DEV) installDevElement(…)`: it adds `update` (the
  remount) and `devElements`, and wraps the element's steps (`_start`,
  `_waitFor`, `_importModule`, …) for the strategies, the notices, the dev
  tool and the dev-only warnings. The class body carries none of it; the
  members it reaches are `_…` rather than `#private`, which a prototype
  cannot reach. The module does nothing at its top level, so a production
  build drops the call, the module and what it imports (`dev-contract`,
  `dev-notify`, `virtual:droplets-dev`). The client modules' HMR fallback
  and `update` are generated for dev only, React's Fast Refresh export hook
  is under `import.meta.env.DEV`, and `dev` of the config resolves apart
  (`resolveDevConfig`), so a production server never carries it.
  `tests/dev-mixed/test/production.test.ts` builds every renderer for
  production and fails on any dev marker or dev module in the output.
- **Limits:** Svelte 5 and solid-refresh create the component again, so
  its local state starts over. A Vue `<script>` edit does the same. A
  `prerender` change shows only in a build.

## `host`: where a droplet renders (built 2026-11-09)

Two words, two things:

- **location**: where the droplet *lives*, the droplets server as the
  browser reaches it. On the server the resolved location (see "The
  droplet location" above: `x-droplet-location` and the forwarded headers
  against an allow-list, else the request's origin), the
  URL `/index.js` was loaded from in the browser, `droplet.url()` from
  `$droplets/drop`. (`data-droplet-location` is gone since the tighten step:
  markup never says where to load code from.)
- **host**: where the droplet *renders*, the host page. `event.host: URL` on
  `RequestEvent` (so `handle` and `+server.ts` have it), `LoadEvent`,
  `TransformEvent` and `DropletLoadEvent`. `url` left the droplet events
  (`request.url` is the fragment's own URL; `RequestEvent.url` stays for
  `handle` and `+server.ts`).

On the server `host` is taken the classic way, no trust list: the `host` of
a render request's JSON body (`{ host, props }`, `{ context: { host, props } }`),
then `Forwarded`, then `X-Forwarded-Proto` + `X-Forwarded-Host`, then
`Origin`, then the request's own origin. Headers carry no path: `/`. `handle`
may replace it (`event.host = new URL(whatever)`), e.g. from `Referer` or
`X-Forwarded-Uri`; loads, `transform` and the context sent to the browser see
what `handle` left; `hostFrom()` from `$droplets/server` checks a candidate
the way the default is checked. In the browser the universal load gets the
page (`window.location` without its hash), read once at mount (not reactive
to SPA navigation). The browser never forwards the page's query string to
`_data`: props travel in the body's context only (a POST never takes props
from its query). The wire context carries `host` (it replaced `url`) and goes back
to the server as it came, so `_data` loads see the host the fragment was
rendered for.

Prerendering: `entries` returns events, `{ props?, host? }`. An entry renders
for its `host`, else `host` of `droplets.config.ts`, else host-agnostic. Host-agnostic renders get a stand-in: `origin` →
`__$DROPLET_HOST$__`, `pathname` → `__$DROPLET_PATH$__`, `href` /
`toString()` / `toJSON()` → both; any other URL field throws
`HostUrlPropsErrorInPrerender`, recorded on the render so a `try`/`catch`
cannot hide it, and the build stops (it skips `handleError` and is never
stored as `+error.*`). Per request, before the user's `transform`, the
framework replaces the tokens with the real `host`: in the HTML
(attribute-escaped), in the inline data (JSON-escaped), and in their
`encodeURIComponent` forms. The store key is the `propsKey`, plus
`origin + pathname` for a render made for a known host; a request gets the
render for its host, else the host-agnostic one, else a live render. A
fixed-host render is never served to another host.

## Form actions in `+droplet.server.ts` (design; steps 1–5 built)

Mirror SvelteKit: `+droplet.server.ts` exports `load` and `actions`; the
component gets `data` and `form` (the result of the last action, as in Kit).

```ts
export const actions = {
  default: async ({ request, cookies, host }) => { … },
  add: async ({ request, locals, cookies }) => {
    const form = await request.formData();
    if (!form.get("sku")) return fail(400, { missing: "sku" });
    await cart.add(cookies.get("cart_id"), form.get("sku"));
    return { added: true };
  },
};
```

```svelte
<script lang="ts">
  import { actionUrl } from "$droplets/form";
  import { enhanceDropletForm } from "@dropletsjs/renderer-svelte/form";
  import type { DropletActions } from "./$types";
  let { data, form } = $props();
  const add = actionUrl<DropletActions>("add");
</script>

<form method="post" action={add} use:enhanceDropletForm={{ action: "add" }}>…</form>
```

### Routing: one route, dispatched by content type

`POST /droplets/:id` already renders with a JSON body. The content type
decides:

| Request | Runs |
| --- | --- |
| `application/json` | the render, as today: `{ host, props }` from the body |
| `application/x-www-form-urlencoded` or `multipart/form-data`, no `?/name` | `actions.default` |
| the same, with `?/name` | `actions[name]` |
| a form for an action the droplet does not export | `405`, as Kit |
| `text/plain` (a form `enctype` too) | `415` |

- `name` resolves with `Object.hasOwn` against the exported object only;
  `__proto__`, `constructor`, `prototype` are rejected. The client never
  chooses a module, a path or anything dynamic.
- Props come from the query string or `x-droplet-props`, never from the form
  body. The same `handle`, `locals`, CORS and props schema as `load`.
- After an action, the loads run again (as Kit after a success), and the
  component renders with `form`. `fail(status, data)` and `redirect()` come
  from `$droplets/server`, next to `error()`.
- `form` reaches every renderer, Handlebars included (`{{form.missing}}`);
  `./$types` generates `ActionData`.

### Where the form posts: `actionUrl()` (built in steps 3–4)

- One neutral URL: `${location}/droplets/<id>?/name&<props>` (`location` as
  `$droplets/drop` has it: the resolved location on the server, `/index.js`'s URL in the
  browser). The same string on the server, in the browser and in a
  prerendered render, where `location` is a token
  (`__$DROPLET_LOCATION_<nonce>$__`) replaced per request in the same step
  as the `host` tokens. No hydration mismatch, nothing to switch on mount.
- The URL does not say how to answer; the request does. `accept:
  application/json` (an enhanced form, any script) gets the result as JSON;
  anything else is a native navigation, answered Post/Redirect/Get (step 5,
  below).
- `actionUrl(name?)` in `$droplets/form`, in every framework, typed per
  droplet with `DropletActions` of `./$types`. In the browser it knows the
  render only synchronously: called as the component sets up
  (`useState(() => actionUrl())` in React and Hono JSX), or given
  `{ droplet, props }`. Handlebars keeps `{{action "add"}}`.
- Gone in step 4: the reserved `noJS` key (it was the PRG signal) and
  `useAction()` with its mount-time switch to the URL without `noJS`.

### With JavaScript: `enhanceDropletForm` (built in step 4)

Opt-in per form, as Kit's `use:enhance`; the element intercepts nothing on
its own. `enhanceDropletForm(form, options?)` in `$droplets/form` (vanilla,
returns its cleanup), wrapped by each renderer's `/form`: a Svelte action
and a Solid directive (`use:enhanceDropletForm`), `useEnhanceDropletForm`
for React, Hono JSX and Vue; `data-droplets-enhance` on a form, bound by
`/index.js`, for Handlebars or any droplet. It:

- intercepts only a `POST` to its own droplet's action, by exact origin and
  path against the hosting element's location and id;
- sends `new FormData(form, submitter)` (`formaction`, `formenctype`
  honoured) with `accept: application/json` and `redirect: "manual"`;
- parses the answer with `JSON.parse` and checks its shape;
- by default calls the element's `updateForm(form)`: a hydrated droplet
  renders again with `form` and fresh data (its loads as a `_data`
  refresh); a `hydrate = false` droplet gets its fragment re-rendered with
  `form` (a JSON render that carries `form`) and swapped in;
- follows a redirect with `location.assign`, http(s) only;
- ignores a second submit while one is in flight.

Options: `action` (a name of `DropletActions`; the others are left to the
browser), `onSubmit({ form, formData, cancel })`, `onResult({ type, status,
data, update })` with `data` typed by the action.

After every enhanced action, `droplets:action` is dispatched on `window`,
with `detail: { droplet, action, type, status, data }` (`type` is
`success`, `failure` or `redirect`; `data` a plain JSON copy, never a
reference or a function). Other droplets listen for it and refresh: the
cart badge after `?/add` in a non-hydrating product page. Without
JavaScript there is no event, and none is needed: the PRG reload renders
every droplet afresh.

### Without JavaScript: Post-Redirect-Get to `host` (built in step 5; see its notes)

A classic POST (one that does not accept JSON) navigates the browser to the droplets
server, which renders a fragment, never the host's page. So the answer is
always a `303` back to the host page:

- same origin (the host proxies `/droplets`): the browser's `Referer` is the
  full page URL;
- cross origin without a proxy: `Referer` is cut to the origin, so
  `actionUrl()` carries the page (`host`, as the render knew it, through
  `handle`) in the action URL;
- no usable target: the droplet renders its own page on its origin with the
  result and a link back.

`redirect(303, "/admin")` from an action resolves against `host`, not the
droplets origin. The target is validated with `trustedOrigins` (the same
origin always passes); otherwise the droplet's own page with a link back.

The action's result rides on the redirect as
`__droplet_form_<droplet>_<build>=<payload>`, one key per droplet, so
several droplets' forms on one page each get theirs:

- `payload` is `{ status, data, exp }` as base64url, plus an HMAC-SHA256 of
  it with `DROPLETS_SECRET`, through WebCrypto (every runtime, no
  dependency). Valid 5 minutes; afterwards, or when the signature does not
  match, it is ignored and the droplet renders without `form`.
- About 2 KB at most; a larger result is not carried (a warning in dev).
- Without `DROPLETS_SECRET` the result is not carried, and the server logs a
  warning at startup.
- The `__droplet_form_` prefix is reserved: never a prop.
- Host contract: forward the page's query to the fragment fetch.
- Only for submits without JavaScript: with JavaScript, the intercepted
  fetch gets the result as JSON.

### Decided

- **Repeated droplets with identical forms on one page are the host's
  responsibility.** The action result applies to every instance of that
  droplet on the page; documented, no instance key.
- **CSRF** (built in step 1): an `Origin` check on form-content-type
  `POST`/`PUT`/`PATCH`/`DELETE` (they are simple requests, no preflight) to
  `/droplets/*` and `/api/*`, against a configurable `trustedOrigins` option
  (plus `DROPLETS_TRUSTED_ORIGINS` at runtime since the tighten step);
  the request's own origin and its location's are always allowed, anything else,
  or no `Origin`, answers `403`, as Kit's `csrf.checkOrigin`. An unsafe
  request with no content type is refused too when it has an untrusted
  `Origin`. The same list validates the redirect target after an action (no
  open redirect).
- **Cookies** (built in step 1, tightened): SvelteKit-style `event.cookies`
  (`get`, `getAll`, `set`, `delete`, `serialize`) on the event of `handle`,
  `+server.ts`, and actions when they come. `load` and `transform` read
  only (`ReadonlyCookies`; `set`/`delete` throw).
  Using cookies while prerendering throws `CookiesInPrerenderError` and stops
  the build, as the host stand-in does. A `Set-Cookie` on a fragment fetched
  server-side reaches the host's server, which forwards it to the browser.
- **Body limits** (built in step 1): JSON, form, multipart and
  `x-droplet-props`, configurable; `413` (`431` for the header).
- **The no-JS result**: the signed `__droplet_form_<droplet>_<build>` key
  above.
- **No `noJS`, no `useAction()`; enhancement is opt-in**: above (step 4).

### From the shop design (gaps to cover)

- Multipart bodies need a size limit large enough for an admin image upload,
  or the upload goes to `/api` first and the form sends the key.
- `trustedOrigins` must list every host origin (the demo has nine).
- `__droplet_form_*` is reserved like the other framework query keys and
  never a prop.
- Hosts mounted under a prefix (WordPress `/shop/`) need a base path for the
  links a droplet writes; `host.pathname` covers reading it, not writing
  under it.

### Lessons from React2Shell (CVE-2025-55182): a checklist

The RSC Server Actions endpoint deserialised a rich, client-supplied payload
(module references, special types) and let it decide what ran. Steps 2–5
must satisfy each rule below, and test it:

- [ ] **Data only from the client.** `FormData`, or plain `JSON.parse`. No
  `devalue`, superjson or Flight, no `$` references, no revivers that build
  objects. Responses are plain JSON.
- [x] **The client never chooses code.** (step 2: `findAction` in entry-server.) An action is found with
  `Object.hasOwn(actions, name)` and `typeof actions[name] === "function"`,
  and `name` must match `^[A-Za-z_][\w-]*$`. `__proto__`, `constructor`,
  `prototype`, `toString` and `hasOwnProperty` answer `404`. The droplet
  registry is a `Map` built at build time, never `obj[id]`.
- [x] **Order.** (step 2) Resolve the droplet, then the action, and only then read the
  body. A droplet without `actions` never parses a form body (`405`).
- [x] **No merging** (step 2) of client input into internal objects (`Object.assign`,
  deep merge). Input arrives as an argument and the action validates it.
- [x] **`__droplet_form_*` is verified before it is parsed.** (step 5) The HMAC is
  checked, in constant time, before `JSON.parse` sees the payload.
- [ ] **The context the client sends back, `{ host, props }`, is data.**
  `host` goes through `new URL`, props through the schema.
- [ ] **Size limits** (in place since step 1). Errors leave only through
  `handleError`, never with a stack.
- [ ] **Negative tests:**
  - the `?/__proto__` family;
  - `{"__proto__":{"polluted":1}}` through the body, the query and
    `x-droplet-props` leaves `({}).polluted` undefined (props today: covered
    by `test/runtime/security.test.ts`);
  - tampered or expired tokens are ignored;
  - odd multipart field names.

  Step 2 covers the `?/__proto__` family, `__proto__` form fields and query
  keys, a non-plain `actions`, and `405` with the body unread
  (`test/runtime/actions.test.ts`, the conformance kit); step 5 the token
  tests (`test/runtime/form-token.test.ts`, `actions.test.ts`, the kit).
- [x] **The PRG token.** (step 5; the action is inside the MACed payload,
  checked against the droplet's exports after verifying; `exp` may run 60 s
  past the 5 minutes for clock skew between instances) The MAC covers droplet + build + page
  (`origin + pathname`, the follow-up) + action name, not only the payload:
  a token from one droplet, action or page is worthless for another. Verify with `crypto.subtle.verify` (constant time), never by
  comparing strings. Cap the token's length and check its shape (base64url,
  one `.`) before verifying. Bound `exp` (not more than 5 minutes ahead of
  now). Clamp `status` to 400–599 for `fail()`, 200 for success.
  `DROPLETS_SECRET` must be at least 32 bytes; shorter or missing, the
  feature is off, with a warning at startup.
- [x] **The redirect target.** (step 5) Validate by the exact parsed origin
  (`new URL(target).origin` in `trustedOrigins` or our own), never by a
  prefix or a substring. Strip any `__droplet_form_*` already in the target's
  query before adding ours (and, the follow-up, any `?/name` and
  `__droplet_return` key; never a page under `<location>/droplets/`).
- [x] **Content type.** (step 2; `text/plain` answers `415`) A JSON body with `?/name` answers `400`: actions
  take `FormData` only.
- [x] **The request decides, not the URL.** (step 4) `accept:
  application/json` gets JSON; `noJS` is gone. Step 5 may add
  `Sec-Fetch-Mode: navigate` when it chooses PRG for the rest.
- [x] **Cookies are set** (step 2) only in actions, `handle` or `+server.ts`; loads
  and `transform` keep `ReadonlyCookies`.
- [ ] **Docs for hosts:** cookies need same-origin (a proxy) or a host that
  forwards `Set-Cookie` and `Cookie`; a host never forwards `Domain`. A host
  fetching fragments or posting actions server-side uses
  `redirect: "manual"`: following a redirect is an SSRF.
- [x] **`"*"` never counts for the PRG redirect.** (step 5) `trustedOrigins: ["*"]`
  trusts every origin for the `Origin` check, never as a redirect target
  (that would be an open redirect). For the redirect an empty list means the
  server's own origin only, although for `host` an empty list means
  unbounded: the asymmetry is on purpose and the docs say so. The target
  must also pass `webUrl()` (`http:`/`https:` only).
- [x] **The PRG token carries no sensitive data, and is bound to its page.**
  (Step 5 documents "display only" and strips older keys; the follow-up
  binds the MAC to the page's `origin + pathname` and documents what
  `fail()` data may hold.) An attacker can submit the form themselves, take
  the minted `__droplet_form_*` URL and send it to a victim, who then sees
  attacker-chosen `fail()` data as their own form state ("Your order
  failed, call …"): phishing by a minted result. The page binding keeps a
  result minted for one page off every other page of a trusted origin; the
  rest is documentation: `form` is display-only, never authorization state,
  never secrets; `fail()` data is field names and message codes, not the
  submitted values (the JSON is readable without the secret, and rides in
  the URL, history, logs and `Referer`), and it shows again on a reload for
  five minutes. Strip foreign and expired `__droplet_form_*` keys before
  redirecting, so the URL does not grow with every submit.
- [ ] **Parked: binding the PRG token to a session.** Opt-in, for proxied
  same-origin deployments only. The MAC would cover a session cookie (a
  name the action declares) and a token presented without that cookie
  would be ignored. Not by default, and not for cross-origin hosts: there
  the droplets server's cookie is read from an embedded fetch (the element
  fetching `_data` or the fragment from the host page's origin), where
  browsers partition or block third-party cookies, so the binding would
  drop genuine results. Only a page served under the droplets server's own
  origin (a proxy) sees the cookie on both the post and the render.
- [x] **Submit interception rules.** (step 4, `runtime/enhance.ts`, opt-in
  per form) An enhanced form takes over a submit only when the
  submitter's `formaction`, else the form's `action`, resolved against
  `document.baseURI`, matches the droplet's location by exact origin and path
  (`<location>/droplets/<id>`), never a prefix; `formaction` on the submitter
  wins over the form's `action`. Forms inside the host's slot content
  (`[data-droplet-slot]`) and inside a nested droplet belong to someone else and
  are left alone; so are submits with a `target` other than `_self` or that
  another listener already `preventDefault()`ed. Cross-origin hosts: the
  `FormData` fetch is a simple request, so the host's origin must be in
  `trustedOrigins` for the `Origin` check; cookies need
  `credentials: "include"`, an explicit `cors.origin` list with
  `credentials: true`, and `SameSite=None; Secure` cookies. Say so in the
  host docs, not per integration. Built with the `_data` fetch's
  credentials (the default, same-origin); `include` waits for those docs.
  Unit tests: cross-origin, a `javascript:` `formaction`, a look-alike
  prefix, the slot and nested droplets.
- [x] **Location poisoning of `actionUrl()`.** A negative test: an
  untrusted location header never reaches an action URL (it is ignored
  since tighten 2); a cacheable fragment with an action URL varies on the
  location headers.
  (Built in step 3: the conformance kit and `app.test.ts`, prerendered and
  live.)

### Steps

1. Built: `trustedOrigins`, the `Origin` check, body size limits,
   `event.cookies`.
   - Tighten (built): validated location header and `host` (http/https only),
     `/index.js` as the browser's location (no `data-droplet-location`),
     `private, no-store` fragments (`fragmentCacheControl`),
     `DROPLETS_TRUSTED_ORIGINS`, read-only cookies in loads, a generic
     production error, nonced prerender tokens, `Map`/`hasOwn` lookups.
   - Tighten 3 (built): `setHeaders` in server loads (default stays
     `private, no-store`), `Vary` on the host headers on every fragment and
     `_data` answer, GET `_data` documented as the public, cacheable read.
2. Built: actions on the server: content-type dispatch, `default` and
   `?/name`, `fail` and `redirect`, `form` in the six renderers,
   `ActionData`. Actions get `setHeaders` too, with the load's rules (each
   header once, no `set-cookie`, none on an error answer). How it differs
   from the plan above:
   - `noJS` was reserved (never a prop) and stripped in step 3; step 4
     removed it. Until step 5 a native submit got the fragment, as any
     request that does not accept JSON (now only without `DROPLETS_SECRET`).
   - The answer is chosen by `Accept` alone: `application/json` gets
     `{ type, status, data? | location }`, anything else the fragment
     rendered again with `form` (or a `303` for a redirect). A JSON failure
     answers with the failure's status, a JSON redirect with `200` (the
     client follows `location` itself).
   - `fail()` may be thrown as well as returned, as `redirect()`.
   - `ActionDataError`: data that is not plain JSON (a `Date`, a class
     instance, a function, `NaN`, a `bigint`, deeper than 64) answers `500`,
     the reason in dev only.
   - More than one `?/name` answers `400`; an `actions` that is not a plain
     object answers `500` (a bug in the droplet, not the request).
   - A relative `redirect()` resolves against `host`; for a plain form
     that is the page's origin (`Origin`), as no context comes with it.
3. Built: `actionUrl()` with its location token, `useAction()` in each
   renderer, `{{action}}` in Handlebars, `noJS` stripped before any event
   is built. (Step 4 removed `noJS`, `useAction()` and the renderers'
   providers below; the rest stands.) How it differs from the plan above:
   - `useAction` comes from each renderer's `/form` subpath
     (`@dropletsjs/renderer-svelte/form`), not the package root:
     the root is the Vite plugin factory, which imports Node and Vite and
     must not reach a component's bundle. Svelte's is a `.svelte.js` module
     shipped as source (runes), compiled by the project's Svelte.
   - It returns `{ url }` everywhere; in Svelte, Vue and Solid `url` is a
     reactive getter, in React and Hono JSX a value of the render.
   - The props that are strings, numbers or booleans ride in the action URL
     (`?/add&productId=p1&noJS`), reserved keys never: the action and the
     render after it need them, and a form without JavaScript has no other
     way to send them. Other props do not travel; documented.
   - `actionUrl(name?, { noJS?, droplet?, props? })`: `noJS: false` for the
     URL without it, `droplet`/`props` outside a render (it throws without
     them). In the browser it knows the render only while the renderer's
     `mount`/`hydrate` runs synchronously (a `globalThis` slot around the
     call); on the server it reads the request store, which now also holds
     the droplet rendering. A name that is not `[A-Za-z_][\w-]*` throws.
   - The location token is `__$DROPLET_LOCATION_<nonce>$__`, in every
     build-time render (with a host or without), so every render now stores
     its nonce; `$droplets/drop`'s `droplet.origin` reads it at build too,
     which fixes prerendered renders holding the build's origin.
   - Both render contexts gained `actionUrl`, the renderer's `useAction`
     reads it from its engine's context (React, Solid and Hono context,
     Vue `provide`, Svelte's root context `Map`, Handlebars' data frame).
     `renderError` takes the droplet's props too, for an error page's forms.
   - Renderer packages joined `SERVER_NO_EXTERNAL`: `/form` is bundled with
     the renderer's server module it shares a context with.
   - Solid's hydration keys gained a level (the provider is a component):
     `<renderId>000` where it was `<renderId>00`, the same on both sides.
   - The conformance kit's guestbook is prerendered, has a second form
     (`leave`) and an `echo` action; `upgradesActions: false` is Handlebars'.
     The hydration check collects `console.error`/`warn`, which the
     production builds of the engines print little of.
4. Built: the enhance step, as above. `enhanceDropletForm` and the
   wrappers, `data-droplets-enhance`, `droplets:action`, `DropletActions`;
   `noJS` and `useAction()` removed. How it differs from the plan above:
   - Opt-in per form, not the element's automatic interception: a form a
     droplet did not enhance posts natively.
   - The element's surface is two methods, `actionTarget()` and
     `updateForm(form)`; a JSON render takes `form` in its body, for the
     `hydrate = false` swap.
   - An update renders the component again: state it keeps for itself
     starts over. `onResult` can apply the result without it (the shop's
     cart does).
   - In the browser `actionUrl()` still needs the render synchronously:
     React and Hono JSX re-renders, Suspense retries and client-only mounts
     capture it with `useState`, or pass `{ droplet, props }`.
     `ClientRenderContext.rendering(fn)` lets a renderer run a deferred
     mount as part of the render (Svelte's `mountSettled`).
   - Solid's hydration keys are `<renderId>00` again (no provider).
   - The conformance kit: `enhance: "wrapper" | "attribute"` replaces
     `upgradesActions`; a `plain` form checks that unenhanced forms post
     natively.
5. Built: no-JS Post/Redirect/Get with the signed `__droplet_form_*`
   result (`runtime/form-token.server.ts`, `runAction` in `runtime/app.ts`),
   the docs, the conformance kit's PRG checks, and the shop's product page
   (Handlebars) and login tested with JavaScript off
   (`examples/shop/test/server.test.ts`). How it differs from the plan above:
   - The back target was the `Referer` only at first; the follow-up added
     `__droplet_return` (below).
   - No usable target answers `400` (plain text) before the action runs,
     not a page of the droplet's own with a link back; a `redirect()` off
     the trusted origins answers `400` too, with or without the secret.
   - The result is read from `event.host` alone (the body's `host`, or what
     `handle` set, e.g. from `Referer`), never from the fragment's query;
     the keys come out of `host` before and after `handle`, and out of the
     browser's universal load `host`.
   - The value is `base64url(JSON { status, data, exp, action })` + `.` +
     `base64url(HMAC)`; the MAC covers a version tag, droplet, build and the
     JSON. Data is copied into null-prototype objects, `__proto__` dropped.
   - A render with a carried result answers `200`, live, with
     `cache-control: private, no-store`; `_data` answers `{ data, form }`
     and the element waits for it before mounting a droplet without inline
     data when the page's URL has its key (added to a server-fetched
     context's `host`, which never has it).
   - Without `DROPLETS_SECRET` (or under 32 bytes) the fragment answers as
     before; the one-time warning comes with the first native post or
     carried result, not at startup (the env is per request on Workers).
   - Not built: binding the result to a session cookie (parked above).
   - Follow-up, built: `actionUrl()` adds `__droplet_return=<origin +
     pathname>` of the page (`event.host` on the server, the host tokens at
     prerender, `window.location` in the browser), a reserved key kept out
     of `host` and the props. The back target is the `Referer` when it is
     that page (for its query), else `__droplet_return`, else a `Referer`
     on its own; each passes `redirectTarget` and is no page under the
     droplets server's `<location>/droplets/`; `?/name` keys are stripped
     from it. The MAC covers the page's `origin + pathname` (version tag
     `droplets-form-v2`), verified against `event.host`. A `no-referrer`
     page sends `Origin: null` and is refused `403`: documented, with the
     `strict-origin-when-cross-origin` meta tag.

### Not in the first step

- `+droplet.api.ts` with `GET`/`POST`/… handlers per droplet: actions cover
  mutations, `_data` and `/api/*` cover reads.

### Positioning note

"Server islands on Svelte, with an HTTP contract." Differences from RSC worth
stating in docs: the product is HTML, cacheable and host-independent, not a
payload that needs a runtime; hydration is opt-in per droplet
(`hydrate = false` ships zero JavaScript); data has a public contract
(`+droplet.server.ts` inline on first render, `/<id>/_data` afterwards).
Closest relatives: OpenComponents, Podium, Astro Server Islands, Cloudflare
Fragments.
