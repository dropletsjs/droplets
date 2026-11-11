import { enhanceDropletForm } from "$droplets/form";

// Prerendered: its action URLs hold the build's location token, replaced per request.
export const prerender = true;

// What the last action returned, or its fail() data, as `form`. `plain`
// is never enhanced: its submit stays the browser's.
export default ({ form, actionUrl }) =>
  `<form method="post" action="${actionUrl()}" data-testid="sign"><input name="name"><p data-testid="form">${form?.message ?? "none"}</p></form>` +
  `<form method="post" action="${actionUrl("leave")}" data-testid="leave"></form>` +
  `<form method="post" action="${actionUrl("echo")}" data-testid="plain"></form>`;

// Mounted: `sign` and `leave` are enhanced.
export function attach(target) {
  const stops = ["sign", "leave"].map((id) => enhanceDropletForm(target.querySelector(`[data-testid=${id}]`)));
  return () => {
    for (const stop of stops) stop();
  };
}
