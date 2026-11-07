// A `.fake.js` component: the reference renderer in @dropletsjs/droplets/testing.
import { env } from "$droplets/env/public";
// A plain dependency: bundled by default, external when the Vite config says so.
import { kebabCase } from "case-anything";

export const ssr = true;
export const hydrate = true;

export default ({ data, children }) =>
  `<section class="p-4"><h1 data-testid="greeting">${data.greeting}</h1>` +
  `<p data-testid="site">${env.PUBLIC_FIXTURE_NAME}</p>` +
  `<p data-testid="dep">${kebabCase("Shared Dep")}</p>` +
  `<button data-testid="count">0</button>` +
  `<div data-testid="children">${children()}</div></section>`;

/** Browser behaviour: the button counts its clicks. */
export function attach(target) {
  const button = target.querySelector("[data-testid=count]");
  let clicks = 0;
  const onClick = () => {
    clicks += 1;
    button.textContent = String(clicks);
  };
  button?.addEventListener("click", onClick);
  return () => button?.removeEventListener("click", onClick);
}
