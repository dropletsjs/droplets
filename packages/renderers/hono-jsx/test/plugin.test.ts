import type { Plugin } from "vite";
import { describe, expect, it } from "vitest";
import { honoJsxPlugin } from "../src/plugin.ts";

type Hook = (this: unknown, ...args: unknown[]) => Promise<unknown>;

type HandlerOfInput = { hook: Plugin["transform"] | Plugin["resolveId"] };

function handlerOf({ hook }: HandlerOfInput): Hook {
  return (typeof hook === "function" ? hook : (hook as { handler: Hook }).handler) as Hook;
}

type Consumer = "client" | "server";

type InEnvironmentInput = { consumer: Consumer };

function inEnvironment({ consumer }: InEnvironmentInput): { environment: { config: { consumer: Consumer } } } {
  return { environment: { config: { consumer } } };
}

describe("the Vite plugin", () => {
  const source = `export default function Hi() { return <p class="x">hi</p>; }\n`;

  it("compiles for hono/jsx on the server and hono/jsx/dom in the browser", async () => {
    const transform = handlerOf({ hook: honoJsxPlugin().transform });
    const server = (await transform.call(inEnvironment({ consumer: "server" }), source, "/app/src/droplets/a/+droplet.tsx")) as {
      code: string;
    };
    const browser = (await transform.call(inEnvironment({ consumer: "client" }), source, "/app/src/droplets/a/+droplet.tsx")) as {
      code: string;
    };
    expect(server.code).toContain(`from "hono/jsx/jsx-runtime"`);
    expect(browser.code).toContain(`from "hono/jsx/dom/jsx-runtime"`);
    expect(browser.code).not.toContain("<p");
  });

  it("leaves node_modules, other files and, when scoped, other renderers' modules alone", async () => {
    const transform = handlerOf({ hook: honoJsxPlugin({ include: /[?&]droplets-renderer=hono-jsx(?:&|$)/ }).transform });
    const env = inEnvironment({ consumer: "client" });
    expect(await transform.call(env, source, "/app/node_modules/x/index.tsx")).toBeNull();
    expect(await transform.call(env, "export const a = 1;", "/app/src/lib/a.ts")).toBeNull();
    expect(await transform.call(env, source, "/app/src/lib/B.tsx?droplets-renderer=react")).toBeNull();
    expect(await transform.call(env, source, "/app/src/lib/B.tsx?droplets-renderer=hono-jsx")).not.toBeNull();
  });

  it("resolves hono/jsx and its runtimes to their DOM builds in the browser only", async () => {
    const resolveId = handlerOf({ hook: honoJsxPlugin().resolveId });
    const asked: string[] = [];
    function context(consumer: Consumer) {
      return {
        ...inEnvironment({ consumer }),
        resolve: async (id: string) => {
          asked.push(id);
          return { id: `/resolved/${id}` };
        },
      };
    }
    expect(await resolveId.call(context("client"), "hono/jsx", "/a.tsx", {})).toEqual({ id: "/resolved/hono/jsx/dom" });
    expect(await resolveId.call(context("client"), "hono/jsx/jsx-runtime", "/a.tsx", {})).toEqual({
      id: "/resolved/hono/jsx/dom/jsx-runtime",
    });
    expect(await resolveId.call(context("server"), "hono/jsx", "/a.tsx", {})).toBeNull();
    expect(await resolveId.call(context("client"), "hono", "/a.tsx", {})).toBeNull();
    expect(asked).toEqual(["hono/jsx/dom", "hono/jsx/dom/jsx-runtime"]);
  });
});
