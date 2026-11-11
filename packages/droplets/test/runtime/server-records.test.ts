import { afterEach, describe, expect, it } from "vitest";
import { locationScript, publicEnvScript } from "../../src/runtime/server-records.ts";

const servers = Symbol.for("droplets.servers");
const global = globalThis as unknown as Record<symbol, Record<string, { origin?: string; env?: Record<string, string> }> | undefined>;

afterEach(() => {
  delete global[servers];
});

describe("locationScript", () => {
  it("records where the module was loaded from: the browser's anchor for this server", () => {
    const script = locationScript("djs-droplet:b1");
    // A module script: `import.meta.url` is the URL the page loaded it from.
    for (const [url, location] of [
      ["https://drops.test/index.js", "https://drops.test"],
      ["https://shop.test/mfe/index.js?strategy=reload", "https://shop.test/mfe"],
    ] as const) {
      delete global[servers];
      new Function("meta", script.replace("import.meta", "meta"))({ url });
      expect(global[servers]?.["djs-droplet:b1"]?.origin).toBe(location);
    }
  });
});

describe("publicEnvScript", () => {
  it("records the values under the server's key, `<` escaped, undefined ones left out", () => {
    const script = publicEnvScript("djs-droplet:b1", { PUBLIC_API: "https://api</script>", PUBLIC_UNSET: undefined });
    expect(script).toBe(
      '\n((globalThis[Symbol.for("droplets.servers")] ??= {})["djs-droplet:b1"] ??= {}).env = ' +
        '{"PUBLIC_API":"https://api\\u003c/script>"};\n',
    );
    new Function(script)();
    expect(global[servers]?.["djs-droplet:b1"]?.env).toEqual({ PUBLIC_API: "https://api</script>" });
  });
});
