import type { Plugin } from "vite";
import { describe, expect, it } from "vitest";
import { preactPlugin } from "../src/plugin.ts";

type Hook = (this: unknown, ...args: unknown[]) => Promise<unknown>;

type HandlerOfInput = { hook: Plugin["transform"] };

type InEnvironmentInput = { consumer: "client" | "server" };

type TransformThis = { environment: { config: { consumer: "client" | "server" } } };

function handlerOf({ hook }: HandlerOfInput): Hook {
  return (typeof hook === "function" ? hook : (hook as { handler: Hook }).handler) as Hook;
}

function inEnvironment({ consumer }: InEnvironmentInput): TransformThis {
  return { environment: { config: { consumer } } };
}

describe("the Vite plugin", () => {
  const source = `export default function Hi() { return <p class="x">hi</p>; }\n`;

  it("compiles for preact/jsx-runtime, on the server and in the browser", async () => {
    const transform = handlerOf({ hook: preactPlugin().transform });
    for (const consumer of ["server", "client"] as const) {
      const out = (await transform.call(inEnvironment({ consumer }), source, "/app/src/droplets/a/+droplet.tsx")) as { code: string };
      expect(out.code).toContain(`from "preact/jsx-runtime"`);
      expect(out.code).not.toContain("<p");
      expect(out.code).not.toMatch(/["']react/);
    }
  });

  it("leaves node_modules, other files and, when scoped, other renderers' modules alone", async () => {
    const transform = handlerOf({ hook: preactPlugin({ include: /[?&]droplets-renderer=preact(?:&|$)/ }).transform });
    const env = inEnvironment({ consumer: "client" });
    expect(await transform.call(env, source, "/app/node_modules/x/index.tsx")).toBeNull();
    expect(await transform.call(env, "export const a = 1;", "/app/src/lib/a.ts")).toBeNull();
    expect(await transform.call(env, source, "/app/src/lib/B.tsx?droplets-renderer=react")).toBeNull();
    expect(await transform.call(env, source, "/app/src/lib/B.tsx")).toBeNull();
    expect(await transform.call(env, source, "/app/src/lib/B.tsx?droplets-renderer=preact")).not.toBeNull();
  });
});
