import { describe, expect, it } from "vitest";
import { mayImportServerOnly, serverOnlyError, serverOnlyPlugin } from "../../src/vite/server-only.ts";
import { createInitialState } from "../../src/vite/state.ts";

describe("serverOnlyError", () => {
  it("prints the chain from the root, virtual ids without their \\0 prefix", () => {
    const error = serverOnlyError({
      root: "/proj",
      chain: ["\0virtual:droplet-client?name=card", "/proj/src/droplets/card/+droplet.ts?v=1", "/proj/src/lib/db.server.ts"],
    });
    expect(error.message).toBe(
      "droplets: src/lib/db.server.ts is server code and cannot reach the browser: " +
        "virtual:droplet-client?name=card -> src/droplets/card/+droplet.ts -> src/lib/db.server.ts. " +
        "Files named *.server.* or under a server/ folder run on the server only: " +
        "read them from +droplet.server.ts and pass what the browser needs as data.",
    );
    expect(error.message).not.toContain("\0");
  });

  it("says a file reference is one, without a chain", () => {
    expect(serverOnlyError({ root: "/proj", chain: ["/proj/src/server/key.txt"], asFile: true }).message).toContain(
      "src/server/key.txt is server code and cannot reach the browser: referenced as a file (",
    );
  });
});

describe("mayImportServerOnly", () => {
  it("allows server files and files under server/, in the project only", () => {
    const ok = (file: string) => mayImportServerOnly({ root: "/proj", importer: file });
    expect(ok("/proj/src/api/+server.ts")).toBe(true);
    expect(ok("/proj/src/hooks.server.ts")).toBe(true);
    expect(ok("/proj/src/droplets/a/+droplet.server.ts")).toBe(true);
    expect(ok("/proj/src/lib/db.server.js")).toBe(true);
    expect(ok("/proj/src/lib/server/db.ts")).toBe(true);
    expect(ok("/proj/src/lib/server/deep/x.js?v=1")).toBe(true);
    expect(ok("/proj/src/droplets/a/+droplet.server.ts?import")).toBe(true);
    expect(ok("/proj/src/droplets/a/+droplet.ts")).toBe(false);
    expect(ok("/proj/src/droplets/a/+droplet.svelte")).toBe(false);
    expect(ok("/proj/src/lib/util.ts")).toBe(false);
    expect(ok("/proj/src/server.tsx")).toBe(false);
    // Any extension after `.server.`; only a folder named exactly `server`.
    expect(ok("/proj/src/lib/db.server.tsx")).toBe(true);
    expect(ok("/proj/src/lib/a.server.mjs")).toBe(true);
    expect(ok("/proj/src/lib/x.server.cts")).toBe(true);
    expect(ok("/proj/src/server/x.ts")).toBe(true);
    // A name that merely ends in "server" is not a server file.
    expect(ok("/proj/src/lib/observer.ts")).toBe(false);
    expect(ok("/proj/src/lib/webserver.js")).toBe(false);
    expect(ok("/proj/src/myserver/x.ts")).toBe(false);
    expect(ok("/proj/src/server-utils/x.ts")).toBe(false);
    // Not the project's to check: dependencies, other folders, virtual modules.
    expect(ok("/proj/node_modules/pkg/index.js")).toBe(true);
    expect(ok("/elsewhere/lib.ts")).toBe(true);
    expect(ok("\0virtual:droplets")).toBe(true);
  });
});

describe("serverOnlyPlugin: the package's server entry", () => {
  const state = createInitialState();
  state.root = "/proj";
  const plugin = serverOnlyPlugin(state);
  const handler = (plugin.resolveId as { handler: (this: unknown, source: string, importer?: string) => Promise<unknown> }).handler;
  const withConsumer = (consumer: string) => ({
    environment: { config: { consumer } },
    error(message: string): never {
      throw new Error(message);
    },
  });
  const bare = "@dropletsjs/droplets/server";

  it("refuses it in a client graph and to project files that are not server files, in build and dev", async () => {
    for (const command of ["build", "serve"] as const) {
      (plugin.configResolved as (config: unknown) => void)({ command, environments: {} });
      await expect(handler.call(withConsumer("client"), bare, "/proj/src/droplets/x/+droplet.svelte"), command).rejects.toThrow(
        /@dropletsjs\/droplets\/server can only be imported by server files.*\+droplet\.svelte/,
      );
      await expect(handler.call(withConsumer("server"), bare, "/proj/src/droplets/x/+droplet.ts"), command).rejects.toThrow(/server files/);
      await expect(handler.call(withConsumer("server"), bare, "/proj/src/droplets/x/+droplet.server.ts"), command).resolves.toBeNull();
      await expect(handler.call(withConsumer("server"), bare, "/proj/src/hooks.server.ts"), command).resolves.toBeNull();
      await expect(
        handler.call(withConsumer("server"), bare, "/proj/node_modules/@dropletsjs/renderer-x/dist/server.js"),
        command,
      ).resolves.toBeNull();
    }
  });
});
