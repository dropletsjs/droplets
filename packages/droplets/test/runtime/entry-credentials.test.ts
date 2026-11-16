// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { serverCredentials, serverKey } from "../../src/runtime/server-records.ts";

vi.mock("virtual:droplets", async (original) => ({ ...(await original<object>()), corsCredentials: true }));

it("records include for its server when the build says cors.credentials, before any element runs", async () => {
  const key = serverKey("djs-droplet", "test01");
  expect(serverCredentials({ key })).toBe("same-origin");
  await import("../../src/runtime/entry-client.ts");
  expect(serverCredentials({ key })).toBe("include");
  expect(serverCredentials({ key: serverKey("other-el", "test01") })).toBe("same-origin");
});
