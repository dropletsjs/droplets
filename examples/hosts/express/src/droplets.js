/**
 * The only code a host needs: fetch a droplet as an HTML fragment.
 *
 * `internalUrl` is how this process reaches the droplets server; `publicUrl`
 * is how the browser will. The second travels in `x-droplet-location`, so the
 * fragment is stamped with the origin the browser can actually load scripts
 * from.
 */
const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char],
  );

export function createDropletClient({ internalUrl, publicUrl }) {
  async function fragment(droplet, props = {}) {
    const url = new URL(`/droplets/${encodeURIComponent(droplet)}`, internalUrl);
    for (const [key, value] of Object.entries(props)) url.searchParams.set(key, String(value));

    try {
      const response = await fetch(url, {
        headers: { accept: "text/html", "x-droplet-location": publicUrl },
        redirect: "manual",
        signal: AbortSignal.timeout(5000),
      });
      // Only an HTML answer is a fragment (a 500 carries the droplet's error
      // page); anything else may echo the props, so it is never pasted.
      const isFragment =
        (response.ok || response.status === 500) && (response.headers.get("content-type") ?? "").startsWith("text/html");
      if (isFragment) return await response.text();
      await response.body?.cancel();
      return `<p class="error">droplet "${escapeHtml(droplet)}" unavailable: HTTP ${response.status}</p>`;
    } catch (error) {
      return `<p class="error">droplet "${escapeHtml(droplet)}" unavailable: ${escapeHtml(String(error))}</p>`;
    }
  }

  /** The one script tag a page needs. */
  const clientScript = `<script type="module" src="${publicUrl}/index.js"></script>`;

  return { fragment, clientScript };
}

export function layout({ title, intro, body, clientScript }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
${clientScript}
</head>
<body style="font-family: system-ui, sans-serif; background: #f8fafc; margin: 0; padding: 2rem;">
<main style="max-width: 48rem; margin: 0 auto;">
<h1>${title}</h1>
<p>${intro}</p>
${body}
</main>
</body>
</html>
`;
}
