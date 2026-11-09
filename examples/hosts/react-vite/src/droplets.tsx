import { useEffect, useRef, useState } from "react";

/** Browser-facing origin of the droplets server. */
export const DROPLETS_URL: string =
  import.meta.env.VITE_DROPLETS_URL ?? "http://localhost:8000";

/** The droplets server's `element` setting (see its droplets.config.ts). */
export const DROPLETS_ELEMENT: string =
  import.meta.env.VITE_DROPLETS_ELEMENT ?? "djs-svelte";

let clientLoaded = false;

/** Loads `/index.js` once per page; it defines the droplet element. */
export function ensureDropletsClient(origin = DROPLETS_URL): void {
  const src = `${origin}/index.js`;
  if (clientLoaded || document.querySelector(`script[src="${src}"]`)) return;
  clientLoaded = true;
  const script = document.createElement("script");
  script.type = "module";
  script.src = src;
  document.head.appendChild(script);
}

const encodeContext = (props: Record<string, unknown>) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify({ props }))));

type DropletProps = {
  id: string;
  props?: Record<string, unknown>;
  /**
   * `fragment` (default): fetch the server-rendered fragment and insert it,
   * so the markup is there before the droplet's JavaScript arrives.
   * `client`: render the element directly; the droplet fetches its own data
   * and mounts fresh. Nothing is rendered until its bundle loads.
   */
  mode?: "fragment" | "client";
  origin?: string;
};

/**
 * One droplet inside a React tree. React owns the wrapper; the custom element
 * owns everything inside it, so React must never re-render the children.
 */
export function Droplet({ id, props = {}, mode = "fragment", origin = DROPLETS_URL }: DropletProps) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const propsKey = JSON.stringify(props);

  useEffect(() => {
    ensureDropletsClient(origin);
    const target = host.current;
    if (!target) return;

    if (mode === "client") {
      // The tag name is the droplets server's `element` setting.
      const element = document.createElement(DROPLETS_ELEMENT);
      // It loads from where /index.js came from: `origin`, above.
      element.dataset["droplet"] = id;
      element.dataset["context"] = encodeContext(props);
      target.replaceChildren(element);
      return () => target.replaceChildren();
    }

    const controller = new AbortController();
    const url = new URL(`/droplets/${encodeURIComponent(id)}`, origin);
    for (const [key, value] of Object.entries(props)) url.searchParams.set(key, String(value));

    fetch(url, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        // Parsing through a <template> lets the custom element upgrade on insert.
        const template = document.createElement("template");
        template.innerHTML = await response.text();
        target.replaceChildren(template.content);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(String(cause));
      });

    return () => {
      controller.abort();
      target.replaceChildren();
    };
    // `propsKey` stands in for `props`, which is a new object every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, mode, origin, propsKey]);

  if (error) return <p className="error">droplet "{id}" unavailable: {error}</p>;
  return <div ref={host} data-droplet-host={id} />;
}
