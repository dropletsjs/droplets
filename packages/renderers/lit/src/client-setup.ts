/**
 * Once per page, before any Lit droplet renders: Lit's hydration support.
 *
 * `lit-element-hydrate-support` must be evaluated before `lit-element`:
 * LitElement installs it when its module is evaluated, if it is there.
 * Core imports this module first in every Lit droplet's client module, so
 * it runs before the renderer and the component (and their `lit`) are
 * evaluated. It is idempotent: it sets one function on `globalThis`.
 *
 * With it, an element that has a shadow root already (the server's,
 * declarative) adopts it on its first update instead of rendering anew,
 * and an element with `defer-hydration` waits until the attribute goes.
 */
import "@lit-labs/ssr-client/lit-element-hydrate-support.js";
