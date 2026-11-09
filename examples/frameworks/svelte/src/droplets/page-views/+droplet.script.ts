import droplet from "$droplets/drop";
import type { PageViews } from "../../lib/page-views.ts";
import type { DropletScript } from "./$types";

/**
 * A page-view tracker, as a script droplet: no component, no framework.
 * The server renders nothing for it; in the browser this runs once per
 * element, with what the load returned (`data`) and the element (`el`).
 * It shows the count it got, posts the view to this server's
 * `/api/page-views`, and shows the new count. The cleanup aborts a post
 * still in flight when the element leaves the page.
 */
const track: DropletScript = (data, el) => {
  const line = document.createElement("p");
  line.className = "text-sm text-slate-600";
  line.dataset["testid"] = "page-views";
  line.textContent = `${data.page}: ${data.views} views so far`;
  el.append(line);

  const controller = new AbortController();
  fetch(droplet.url("/api/page-views"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ page: data.page }),
    signal: controller.signal,
  })
    .then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const counted = (await response.json()) as PageViews;
      line.textContent = `${counted.page}: ${counted.views} views`;
      line.dataset["tracked"] = "yes";
    })
    .catch((error: unknown) => {
      if (!controller.signal.aborted) console.warn("[page-views] could not count this view", error);
    });

  return () => controller.abort();
};

export default track;
