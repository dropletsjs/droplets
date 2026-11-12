---
title: A client-only page
description: "Droplets in a page that renders in the browser: a React single-page app, or a static HTML page, loading /index.js and writing droplet elements or inserting fragments, with the droplets server on another origin or behind a proxy."
---

A single-page app has no server step where it could paste a fragment in
before the page ships. It can still embed droplets: the browser loads the
droplets server's `/index.js`, and the page either writes the droplet
elements itself or fetches the fragments and inserts them. This page builds
that with React and Vite, after
[`examples/hosts/react-vite`](https://github.com/dropletsjs/droplets/tree/main/examples/hosts/react-vite),
which embeds the Svelte example's droplets from `http://localhost:8000`.
Nothing in it is React-specific: any page that runs JavaScript does the same.

## 1. The droplets server

Two settings in the droplets server's `droplets.config.ts` matter here:

```ts
// droplets.config.ts of the droplets server (examples/frameworks/svelte)
import { config } from "@dropletsjs/droplets";

export default config({
  element: "djs-svelte",
  cors: true,
});
```

- `element` is the custom element's tag name (`djs-droplet` by default). The
  page writes it, so it has to know it.
- `cors` lets a page on another origin import `/index.js` and the droplet
  bundles, and request `_data` and `/api/*`. `true` allows any origin; Hono
  `cors()` options (`{ origin: ["https://app.example.com"] }`) restrict it.
  Without `cors`, the page must reach the droplets routes on its own origin
  (see [Same origin through a proxy](#same-origin-through-a-proxy)).

The droplets are ordinary droplets. A droplet that only makes sense in the
browser says so with `ssr = false` in its component: the server never
renders it, and a fragment for it is an empty element carrying its data.
The Svelte example's `client` droplet is one:

```svelte
<!-- src/droplets/client/+droplet.svelte -->
<script module lang="ts">
  export const ssr = false;
  export const hydrate = true;
</script>
```

A droplet with no framework at all is a [script droplet](/renderers/script/)
(`+droplet.script.ts`): it is always client only, and its default export runs
with `(data, el)`.

## 2. Load `/index.js` once

`/index.js` defines the element. Load it once per page, as a module, from the
droplets server. Every droplet element then loads its bundle, stylesheet and
data from the place that `/index.js` came from, path prefix included:

```ts
// src/droplets.tsx
export const DROPLETS_URL: string = import.meta.env.VITE_DROPLETS_URL ?? "http://localhost:8000";
export const DROPLETS_ELEMENT: string = import.meta.env.VITE_DROPLETS_ELEMENT ?? "djs-svelte";

let clientLoaded = false;

export function ensureDropletsClient(origin = DROPLETS_URL): void {
  const src = `${origin}/index.js`;
  if (clientLoaded || document.querySelector(`script[src="${src}"]`)) return;
  clientLoaded = true;
  const script = document.createElement("script");
  script.type = "module";
  script.src = src;
  document.head.appendChild(script);
}
```

A static page writes the tag in its HTML instead:

```html
<script type="module" src="http://localhost:8000/index.js"></script>
```

## 3. Write the element

The element needs the droplet id and its props:

```ts
// src/droplets.tsx, client mode
const encodeContext = (props: Record<string, unknown>) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify({ props }))));

const element = document.createElement(DROPLETS_ELEMENT);
element.dataset["droplet"] = id;
element.dataset["context"] = encodeContext(props);
target.replaceChildren(element);
```

| Attribute | What it holds |
| --- | --- |
| `data-droplet` | The droplet id. An id the build does not have leaves the element inert. |
| `data-params` | The props as plain JSON: `data-params='{"who":"Ana"}'`. |
| `data-context` | Base64 of the UTF-8 JSON `{ "host": …, "props": { … } }`; `host` is optional. Used before `data-params` when both are set; one that does not parse is logged and `data-params` is read instead. |
| `data-hydrate` | Optional: `"visible"` waits until the element is about to scroll into view; `"false"` keeps a framework droplet from running. |

The attributes are read once, when the element connects; changing them later
does nothing. To show other props, replace the element.

What the element then does, with no server markup to adopt:

1. it runs the props schema and the universal load (`+droplet.ts`) in the
   browser, with `host` set to the page's URL without its hash;
2. when the droplet has a `+droplet.server.ts`, it requests
   `POST <location>/droplets/<id>/_data` with the JSON body
   `{ host, props }`;
3. it adds the droplet's stylesheet inside itself and waits for it;
4. it mounts the component. Vue, React, Solid and Hono JSX hand it `data`
   as a promise, and Svelte does in its async mode; the other renderers wait for it and hand it the value (see
   each [renderer's page](/renderers/)).

Nothing shows until the bundle has loaded. A droplet with `hydrate = false`
has no browser bundle, so an element the page writes for it renders nothing:
fetch its fragment instead.

## 4. Or insert the fragment

To show the server's HTML at once and hydrate it after, fetch the fragment
from the browser and insert it. Insert only an HTML answer: a `2xx`, or a
`500`, which carries the droplet's error page; a `400` or `404` is text
that may echo the props. Never follow a redirect (`redirect: "manual"`):
its target is opaque in the browser and could be a page. Parse the
fragment through a `<template>`, so the element upgrades when it enters
the document:

```ts
// src/droplets.tsx, fragment mode
const url = new URL(`/droplets/${encodeURIComponent(id)}`, origin);
for (const [key, value] of Object.entries(props)) url.searchParams.set(key, String(value));

fetch(url, { signal: controller.signal, redirect: "manual", headers: { accept: "text/html" } }).then(async (response) => {
  if (response.type === "opaqueredirect") throw new Error("redirected");
  const isFragment =
    (response.ok || response.status === 500) && (response.headers.get("content-type") ?? "").startsWith("text/html");
  if (!isFragment) throw new Error(`HTTP ${response.status}`);
  const template = document.createElement("template");
  template.innerHTML = await response.text();
  target.replaceChildren(template.content);
});
```

The fragment carries the droplet's data inline, so a hydrating droplet
needs no `_data` request, and a `hydrate = false` droplet shows its markup
with no JavaScript of its own. The request goes from the browser straight to
the droplets server, so the URLs it writes are on that server's own origin;
no `x-droplet-location` is involved.

## 5. Keep the framework out of the element

The page's framework owns a wrapper; the droplet element owns everything
inside it. In React, render an empty `<div ref>` and put the element or the
fragment into it from an effect, clearing it in the cleanup, so React never
re-renders the element's children:

```tsx
// src/droplets.tsx (trimmed)
export function Droplet({ id, props = {}, mode = "fragment", origin = DROPLETS_URL }: DropletProps) {
  const host = useRef<HTMLDivElement>(null);
  const propsKey = JSON.stringify(props);

  useEffect(() => {
    ensureDropletsClient(origin);
    const target = host.current;
    if (!target) return;
    // client mode (step 3) or fragment mode (step 4)
    return () => target.replaceChildren();
  }, [id, mode, origin, propsKey]);

  return <div ref={host} data-react-host={id} />;
}
```

```tsx
// src/App.tsx
<Droplet id="ssr-hydrate" props={{ who }} />
<Droplet id="client" mode="client" />
```

When an element leaves the page, its droplet unmounts; a new element with
new props mounts again.

## Same origin through a proxy

A droplets server on another origin gets no cookies from these requests: the
element's `_data` request and a cross-origin `fetch` go out without
credentials. When droplets need the visitor's cookies (a cart, a login),
serve the droplets routes under the page's own origin instead. The shop pages
of the React example do that: `vite dev`, `vite preview` and the image's
nginx proxy `/index.js`, `/env.js`, `/index.css`, `/droplets/*`, `/assets/*` and `/api/*` to the shop,
with a fixed `x-droplet-location`, and the app loads `/index.js` from its own
origin. The app's own build output then goes under another folder
(`build.assetsDir: "app"`), since `/assets/*` is the droplets server's.
[React + Vite](/integrate/hosts/react-vite/) has that setup, and
[Any other stack](/integrate/any-stack/) the headers a proxy passes on.

## What a client-only page gives up

The page renders in the browser, so without JavaScript it shows nothing, not
even the droplets whose fragments it would insert. Where the first paint or search engines matter, render the page
on a server and paste the fragments in there: see
[Ways to use Droplets](/start/ways-to-use/).
