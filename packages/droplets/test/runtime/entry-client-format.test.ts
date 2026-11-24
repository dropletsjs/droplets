// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";

vi.mock("virtual:droplets", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  const { formatHuman } = await import("../../src/errors/format.ts");
  return { ...original, errorFormatter: formatHuman };
});

it("writes the browser's messages with the build's errorFormatter", async () => {
  (globalThis as unknown as Record<symbol, unknown>)[Symbol.for("droplets.servers")] = {
    "djs-droplet:test01": { origin: "http://drops.test" },
  };
  const { DjsDropletElement } = await import("../../src/runtime/entry-client.ts");
  vi.stubGlobal("fetch", vi.fn());
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  DjsDropletElement.importModule = vi.fn(async () => {
    throw new Error("offline");
  }) as never;
  document.body.innerHTML = '<djs-droplet data-droplet="hello"></djs-droplet>';
  await new Promise((resolve) => setTimeout(resolve, 10));
  const message = String(error.mock.calls[0]?.[0]);
  expect(message).toMatch(/^droplets: hello: /);
  expect(message).toContain("(https://dropletsjs.dev/errors/client-module-failed/)");
});
