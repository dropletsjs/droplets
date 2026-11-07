import { describe, expect, it } from "vitest";
import {
  allowedMethods,
  compareRoutes,
  matchRoute,
  type ApiRoute,
  type RouteSegment,
} from "../../src/runtime/routes.ts";

const s = (value: string): RouteSegment => ({ type: "static", value });
const p = (name: string): RouteSegment => ({ type: "param", name });
const r = (name: string): RouteSegment => ({ type: "rest", name });
const route = (id: string, segments: RouteSegment[]): ApiRoute => ({ id, segments, module: {} });

describe("matchRoute", () => {
  const routes = [
    route("/api", [s("api")]),
    route("/api/users/me", [s("api"), s("users"), s("me")]),
    route("/api/users/[id]", [s("api"), s("users"), p("id")]),
    route("/api/files/[...path]", [s("api"), s("files"), r("path")]),
  ].sort(compareRoutes);

  it.each([
    ["/api", "/api", {}],
    ["/api/", "/api", {}],
    ["/api/users/me", "/api/users/me", {}],
    ["/api/users/42", "/api/users/[id]", { id: "42" }],
    ["/api/users/a%20b", "/api/users/[id]", { id: "a b" }],
    ["/api/files/a/b/c.txt", "/api/files/[...path]", { path: "a/b/c.txt" }],
    ["/api/files", "/api/files/[...path]", { path: "" }],
  ])("%s -> %s", (pathname, id, params) => {
    const match = matchRoute(routes, pathname);
    expect(match?.route.id).toBe(id);
    expect(match?.params).toEqual(params);
  });

  it("returns null when nothing matches", () => {
    expect(matchRoute(routes, "/api/users/1/extra")).toBeNull();
    expect(matchRoute(routes, "/other")).toBeNull();
  });

  it("keeps a malformed escape as written", () => {
    expect(matchRoute(routes, "/api/users/%E0")?.params).toEqual({ id: "%E0" });
  });
});

describe("compareRoutes", () => {
  it("puts static before params before rest, then longer first", () => {
    const sorted = [
      route("rest", [s("api"), r("x")]),
      route("param", [s("api"), p("x")]),
      route("static", [s("api"), s("x")]),
      route("short", [s("api")]),
      route("deep", [s("api"), s("x"), s("y")]),
    ].sort(compareRoutes).map((x) => x.id);
    expect(sorted).toEqual(["deep", "static", "param", "rest", "short"]);
  });
});

describe("allowedMethods", () => {
  it("lists exported methods and adds HEAD for GET", () => {
    const handler = () => new Response();
    expect(allowedMethods({ GET: handler, POST: handler })).toEqual(["GET", "POST", "HEAD"]);
    expect(allowedMethods({ PUT: handler, fallback: handler })).toEqual(["PUT"]);
  });
});
