// Waits until WordPress answers the shop's product route: WordPress is
// installed, the Droplets Embed plugin is active (it registers the
// `product` post type, `show_in_rest`) and so the catalogue is there
// (examples/hosts/wordpress imports it before it activates the plugin).
// `vite build` reads it next, to prerender.
//
//   node scripts/wait-for-wordpress.mjs   (WP_INTERNAL_URL, WP_WAIT_MINUTES default 10)

const base = (process.env.WP_INTERNAL_URL || "http://localhost:8008").replace(/\/+$/, "");
const minutes = Number(process.env.WP_WAIT_MINUTES || 10);
const until = Date.now() + minutes * 60_000;
const url = `${base}/wp-json/wp/v2/products?per_page=1&_fields=id`;

let last = "";
while (Date.now() < until) {
  try {
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(5000) });
    const total = response.headers.get("x-wp-total");
    const json = response.headers.get("content-type")?.includes("application/json");
    await response.body?.cancel();
    if (response.status === 200 && json && total && Number(total) > 0) {
      console.log(`[wp-shop] WordPress answers: ${total} products at ${base}`);
      process.exit(0);
    }
    last = `HTTP ${response.status}${total === "0" ? ", no products yet" : ""}`;
  } catch (error) {
    last = String(error?.cause?.code ?? error?.message ?? error);
  }
  if (last) console.log(`[wp-shop] waiting for WordPress at ${base} (${last})`);
  await new Promise((resolve) => setTimeout(resolve, 3000));
}
console.error(`[wp-shop] WordPress did not answer in ${minutes} minutes (${last})`);
process.exit(1);
