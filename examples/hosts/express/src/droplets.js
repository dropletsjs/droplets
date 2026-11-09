/**
 * The only code a host needs: fetch a droplet as an HTML fragment.
 *
 * `internalUrl` is how this process reaches the droplets server; `publicUrl`
 * is how the browser will. The second travels in `x-host`, so the fragment
 * is stamped with the origin the browser can actually load scripts from.
 */
export function createDropletClient({ internalUrl, publicUrl }) {
  async function fragment(droplet, props = {}) {
    const url = new URL(`/droplets/${encodeURIComponent(droplet)}`, internalUrl);
    for (const [key, value] of Object.entries(props)) url.searchParams.set(key, String(value));

    try {
      const response = await fetch(url, { headers: { "x-host": publicUrl } });
      if (!response.ok) {
        return `<p class="error">droplet "${droplet}" unavailable: HTTP ${response.status}</p>`;
      }
      return await response.text();
    } catch (error) {
      return `<p class="error">droplet "${droplet}" unavailable: ${String(error)}</p>`;
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
