import type { RequestHandler } from "./server.ts";

/** One piece of an API route path. */
export type RouteSegment =
  | { type: "static"; value: string }
  | { type: "param"; name: string }
  | { type: "rest"; name: string };

export const API_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"] as const;
export type ApiMethod = (typeof API_METHODS)[number];

/** The exports of a `+server.ts`. */
export type ApiModule = Partial<Record<ApiMethod | "fallback", RequestHandler>>;

export type ApiRoute = {
  /** The route as written on disk, e.g. `/api/users/[id]`. */
  id: string;
  segments: RouteSegment[];
  module: ApiModule;
};

export type ApiMatch = {
  route: ApiRoute;
  params: Record<string, string>;
};

const RANK = { static: 0, param: 1, rest: 2 } as const;

/**
 * Most specific first: at the first segment that differs, static beats a
 * parameter, which beats a rest parameter. Among routes that agree segment
 * for segment, the longer one wins.
 */
export function compareRoutes(a: { segments: RouteSegment[] }, b: { segments: RouteSegment[] }): number {
  const length = Math.max(a.segments.length, b.segments.length);
  for (let i = 0; i < length; i++) {
    const left = a.segments[i];
    const right = b.segments[i];
    if (!left) return 1;
    if (!right) return -1;
    const diff = RANK[left.type] - RANK[right.type];
    if (diff !== 0) return diff;
  }
  return 0;
}

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function matchSegments(
  segments: RouteSegment[],
  parts: string[],
): Record<string, string> | null {
  const params: Record<string, string> = {};
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!;
    if (segment.type === "rest") {
      // Zero or more segments, like SvelteKit.
      params[segment.name] = parts.slice(i).join("/");
      return params;
    }
    const part = parts[i];
    if (part === undefined) return null;
    if (segment.type === "static") {
      if (part !== segment.value) return null;
    } else {
      params[segment.name] = part;
    }
  }
  return parts.length === segments.length ? params : null;
}

/** The first route matching `pathname`; `routes` must already be sorted. */
export function matchRoute(routes: ApiRoute[], pathname: string): ApiMatch | null {
  const parts = pathname.split("/").filter(Boolean).map(decode);
  for (const route of routes) {
    const params = matchSegments(route.segments, parts);
    if (params) return { route, params };
  }
  return null;
}

/** Methods a module answers, as listed in an `Allow` header. */
export function allowedMethods(module: ApiModule): string[] {
  const methods: string[] = API_METHODS.filter((method) => typeof module[method] === "function");
  if (methods.includes("GET") && !methods.includes("HEAD")) methods.push("HEAD");
  return methods;
}
