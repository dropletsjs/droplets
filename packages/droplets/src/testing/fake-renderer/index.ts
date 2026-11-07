/**
 * A complete, tiny renderer for `.fake.js` components, used by core's own
 * tests and offered as the reference implementation of the contract in
 * `renderer.ts`. A component is a plain module:
 *
 * ```js
 * // +droplet.fake.js
 * export const hydrate = true;                       // flags, read by core
 * export default ({ data, children, actionUrl }) => // server and browser
 *   `<h1 data-testid="greeting">${data.greeting}</h1><div>${children()}</div>` +
 *   `<form method="post" action="${actionUrl("add")}"></form>`;
 * export function attach(target, { data }, context) { // browser only, optional
 *   const button = target.querySelector("button");
 *   const onClick = () => { ... };
 *   button?.addEventListener("click", onClick);
 *   return () => button?.removeEventListener("click", onClick);
 * }
 * export const head = "<style>.oops { color: crimson }</style>";  // optional
 * ```
 *
 * No Vite plugin is needed: the files are JavaScript. Hydration keeps the
 * server HTML and runs `attach`; `mount` waits for `data` (a promise when
 * mounting) and writes the HTML first, or the error page's when it rejects. CSS comes
 * from `import "./style.css"` lines in the component, as for any module.
 */
import { resolve } from "node:path";
import { packageDist } from "../../core/paths.ts";
import type { DropletRenderer } from "../../renderer.ts";

/** The fake renderer, for `droplets({ renderers: [fakeRenderer()] })`. */
export function fakeRenderer(): DropletRenderer {
  return {
    name: "fake",
    extensions: [".fake.js"],
    server: resolve(packageDist, "testing/fake-renderer/server.js"),
    client: resolve(packageDist, "testing/fake-renderer/client.js"),
  };
}
