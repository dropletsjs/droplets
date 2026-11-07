import { describe, expect, it } from "vitest";
import { withRequestInfo } from "../../src/runtime/request-store.ts";
import {
  ActionFailure,
  error,
  fail,
  hostFrom,
  HttpError,
  isActionFailure,
  isHttpError,
  isRedirect,
  json,
  redirect,
  sequence,
  text,
  type Handle,
  type RequestEvent,
} from "../../src/runtime/server.ts";

const thrown = (fn: () => unknown): unknown => {
  try {
    fn();
  } catch (value) {
    return value;
  }
  throw new Error("expected a throw");
};

describe("error()", () => {
  it("throws an HttpError with a default message per status", () => {
    const value = thrown(() => error(404));
    expect(isHttpError(value)).toBe(true);
    expect(value).toMatchObject({ status: 404, body: { message: "Not Found" } });
    expect(thrown(() => error(418, "teapot"))).toMatchObject({ body: { message: "teapot" } });
    expect(thrown(() => error(499))).toMatchObject({ body: { message: "Error 499" } });
  });

  it("rejects statuses outside 400-599", () => {
    expect(() => error(302)).toThrow(/between 400 and 599/);
    expect(() => error(600)).toThrow(/between 400 and 599/);
  });
});

describe("fail()", () => {
  it("returns an ActionFailure with the status and the data", () => {
    const failure = fail(422, { message: "A name, please" });
    expect(failure).toBeInstanceOf(ActionFailure);
    expect(isActionFailure(failure)).toBe(true);
    expect(failure).toMatchObject({ status: 422, data: { message: "A name, please" } });
    expect(fail(400).data).toBeUndefined();
    expect(isActionFailure({ status: 422, data: {} })).toBe(false);
  });

  it("rejects statuses outside 400-599", () => {
    for (const status of [200, 303, 399, 600, 422.5, Number.NaN]) {
      expect(() => fail(status), String(status)).toThrow(/between 400 and 599/);
    }
  });
});

describe("redirect()", () => {
  it("throws a Redirect with the location as a string", () => {
    const value = thrown(() => redirect(303, new URL("https://x.test/next")));
    expect(isRedirect(value)).toBe(true);
    expect(value).toMatchObject({ status: 303, location: "https://x.test/next" });
  });

  it("rejects non-redirect statuses", () => {
    expect(() => redirect(200 as 301, "/")).toThrow(/between 300 and 308/);
  });

  it("takes http(s) URLs and paths on the site, nothing else", () => {
    for (const ok of ["/next", "/a?b=1#c", "./x", "?q=1", "next", "https://x.test/next", "http://x.test"]) {
      expect(thrown(() => redirect(303, ok)), ok).toMatchObject({ location: ok });
    }
    for (const bad of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "//evil.example",
      "/\\evil.example",
      "\\\\evil.example",
      " //evil.example",
      "/ok\r\nSet-Cookie: x=1",
      "/tab\there",
      "",
    ]) {
      expect(() => redirect(303, bad), JSON.stringify(bad)).toThrow(/needs an http\(s\) URL or a path/);
    }
  });
});

describe("hostFrom()", () => {
  it("takes web URLs only, without credentials or hash", () => {
    expect(hostFrom("https://shop.test/p?q=1#x")?.href).toBe("https://shop.test/p?q=1");
    expect(hostFrom("https://u:p@shop.test/")?.href).toBe("https://shop.test/");
    for (const bad of [null, undefined, "", "not a url", "javascript:alert(1)", "data:,x", "ftp://shop.test/"]) {
      expect(hostFrom(bad), String(bad)).toBeNull();
    }
  });

  it("keeps within trustedOrigins and this server, when the request has a list", () => {
    const within = (value: string, trustedOrigins: string[]) =>
      withRequestInfo({ origin: "https://drops.test", trustedOrigins, ownOrigins: ["https://drops.test"] }, () =>
        hostFrom(value)?.href ?? null
      );
    expect(within("https://shop.test/p", ["https://shop.test"])).toBe("https://shop.test/p");
    expect(within("https://drops.test/p", ["https://shop.test"])).toBe("https://drops.test/p");
    expect(within("https://evil.test/p", ["https://shop.test"])).toBeNull();
    expect(within("https://evil.test/p", [])).toBe("https://evil.test/p");
  });
});

describe("brands", () => {
  it("recognise errors from another copy of the module", () => {
    // Same global symbol, different class: what a second module instance looks like.
    const foreign = { [Symbol.for("droplets.http-error")]: true, status: 400, body: { message: "x" } };
    expect(isHttpError(foreign)).toBe(true);
    expect(isHttpError(new Error("plain"))).toBe(false);
    expect(isRedirect(new HttpError(400))).toBe(false);
    expect(isHttpError(null)).toBe(false);
  });
});

describe("json() and text()", () => {
  it("set a content type unless one is given", async () => {
    const res = json({ a: 1 }, { status: 201 });
    expect(res.status).toBe(201);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.json()).toEqual({ a: 1 });

    const custom = json([], { headers: { "content-type": "application/vnd.x+json" } });
    expect(custom.headers.get("content-type")).toBe("application/vnd.x+json");

    const plain = text("hi");
    expect(plain.headers.get("content-type")).toContain("text/plain");
    expect(await plain.text()).toBe("hi");
  });
});

describe("sequence()", () => {
  const event = {
    request: new Request("http://x.test/"),
    url: new URL("http://x.test/"),
    params: {},
    locals: {},
    platform: {},
  } as RequestEvent;

  it("runs handles in order, each resolving into the next", async () => {
    const order: string[] = [];
    const step = (name: string): Handle => async ({ event, resolve }) => {
      order.push(`${name}:in`);
      event.locals[name] = true;
      const response = await resolve(event);
      order.push(`${name}:out`);
      response.headers.append("x-steps", name);
      return response;
    };
    const handle = sequence(step("a"), step("b"));
    const response = await handle({
      event,
      resolve: async (final) => {
        order.push(`resolve:${Object.keys(final.locals).join(",")}`);
        return new Response("done");
      },
    });
    expect(order).toEqual(["a:in", "b:in", "resolve:a,b", "b:out", "a:out"]);
    expect(response.headers.get("x-steps")).toBe("b, a");
  });

  it("lets an early handle answer without the rest", async () => {
    const later: Handle = () => {
      throw new Error("must not run");
    };
    const handle = sequence(() => new Response("stop", { status: 401 }), later);
    const response = await handle({ event, resolve: async () => new Response("nope") });
    expect(response.status).toBe(401);
  });

  it("resolves directly with no handles", async () => {
    const response = await sequence()({ event, resolve: async () => new Response("direct") });
    expect(await response.text()).toBe("direct");
  });
});
