import { useSyncExternalStore } from "react";

/**
 * The smallest router that will do: the app reads `location` and re-renders
 * on `popstate`; `navigate()` pushes a URL and announces it the same way.
 * Links inside droplets are plain links: they load the page again, and the
 * server answers every route with this app.
 */
const subscribe = (onChange: () => void) => {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
};

const snapshot = () => window.location.pathname + window.location.search;

/** `pathname + search`, kept current. */
export function useLocation(): URL {
  const href = useSyncExternalStore(subscribe, snapshot);
  return new URL(href, window.location.origin);
}

export function navigate(href: string): void {
  window.history.pushState(null, "", href);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** As `navigate()`, in place of the current history entry. */
export function replace(href: string): void {
  window.history.replaceState(null, "", href);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** An `onClick` for host links: client-side for a plain left click, the browser's own otherwise. */
export function onLinkClick(event: React.MouseEvent<HTMLAnchorElement>): void {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return;
  }
  event.preventDefault();
  navigate(event.currentTarget.getAttribute("href") ?? "/");
}
