import { describe, expect, it } from "vitest";
import { config, DEFAULTS, isValidElementName, normalizeDropletsFolder, resolveConfig, resolveDevConfig } from "../../src/core/config.ts";

describe("config()", () => {
  it("is an identity helper", () => {
    const value = { dropletsFolder: "src/droplets" };
    expect(config(value)).toBe(value);
  });
});

describe("isValidElementName", () => {
  it.each([
    ["djs-droplet", true],
    ["a-b.c_d", true],
    ["x-", true],
    ["nohyphen", false],
    ["Upper-case", false],
    ["9-start", false],
  ])("%s -> %s", (name, valid) => {
    expect(isValidElementName(name)).toBe(valid);
  });
});

describe("normalizeDropletsFolder", () => {
  it.each([
    ["src/droplets", "src/droplets"],
    ["./src/droplets", "src/droplets"],
    ["src/droplets/", "src/droplets"],
    ["./src/droplets/", "src/droplets"],
    ["src\\droplets", "src/droplets"],
    ["src//droplets", "src/droplets"],
    ["  src/droplets  ", "src/droplets"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeDropletsFolder(input)).toBe(expected);
  });

  it("falls back to the default for empty values", () => {
    expect(normalizeDropletsFolder("")).toBe(DEFAULTS.dropletsFolder);
    expect(normalizeDropletsFolder("./")).toBe(DEFAULTS.dropletsFolder);
  });
});

describe("resolveConfig", () => {
  it("applies defaults", () => {
    expect(resolveConfig({})).toEqual({
      dropletsFolder: "src/droplets",
      apiFolder: "src/api",
      health: "/health",
      importMap: { path: "/importmap", auto: true },
      warnImportMap: true,
      element: "djs-droplet",
      origin: [],
      trustedOrigins: [],
      fragmentCacheControl: "private, no-store",
      csrf: { checkOrigin: true },
      limits: DEFAULTS.limits,
      server: { port: DEFAULTS.serverPort },
    });
    // `dev` apart, for the Vite plugin: a production server never resolves it.
    expect(resolveDevConfig({})).toEqual({ server: { port: DEFAULTS.devPort }, strategy: "hmr", injectTool: false });
  });

  it("normalizes origin to locations, a prefix allowed, and refuses anything else", () => {
    expect(resolveConfig({ origin: "https://shop.example/" }).origin).toEqual(["https://shop.example"]);
    expect(resolveConfig({ origin: ["https://shop.example/mfe/", "http://localhost:3000", "*"] }).origin).toEqual([
      "https://shop.example/mfe",
      "http://localhost:3000",
      "*",
    ]);
    for (const bad of [
      "shop.example",
      "ftp://shop.example",
      "https://u:p@shop.example",
      "https://shop.example/a?x=1",
      "https://shop.example/#x",
      "https://shop.example//x",
      "https://shop.example/a\\b",
      `https://shop.example/${"a".repeat(300)}`,
      "https://*.example",
      "",
      42,
    ]) {
      expect(() => resolveConfig({ origin: [bad as string] }), String(bad)).toThrow("origin takes this server's public URL");
    }
    expect(() => resolveConfig({ origin: { url: "https://a.example" } as never })).toThrow("origin takes");
  });

  it("normalizes trustedOrigins and refuses what is not an origin", () => {
    expect(resolveConfig({ trustedOrigins: ["https://shop.example/", "http://localhost:3000", "*"] }).trustedOrigins).toEqual([
      "https://shop.example",
      "http://localhost:3000",
      "*",
    ]);
    for (const bad of ["shop.example", "https://shop.example/cart", ""]) {
      expect(() => resolveConfig({ trustedOrigins: [bad] }), bad).toThrow("trustedOrigins takes origins");
    }
    expect(() => resolveConfig({ trustedOrigins: "https://a.example" as never })).toThrow("must be a list");
    expect(resolveConfig({ csrf: { checkOrigin: false } }).csrf).toEqual({ checkOrigin: false });
  });

  it("takes a Cache-Control for fragments, or false for none", () => {
    expect(resolveConfig({ fragmentCacheControl: " public, max-age=60 " }).fragmentCacheControl).toBe("public, max-age=60");
    expect(resolveConfig({ fragmentCacheControl: false }).fragmentCacheControl).toBe(false);
    for (const bad of ["", "a\r\nset-cookie: x=1", 60]) {
      expect(() => resolveConfig({ fragmentCacheControl: bad as never }), String(bad)).toThrow("fragmentCacheControl must be");
    }
  });

  it("merges limits with the defaults and refuses non-positive ones", () => {
    expect(resolveConfig({ limits: { multipart: 1 } }).limits).toEqual({ ...DEFAULTS.limits, multipart: 1 });
    expect(resolveConfig({ limits: { json: Infinity } }).limits.json).toBe(Infinity);
    expect(() => resolveConfig({ limits: { json: 0 } })).toThrow("limits.json must be a positive number of bytes");
  });

  it("takes a dev strategy and refuses an unknown one", () => {
    expect(resolveDevConfig({ dev: { strategy: "reload" } }).strategy).toBe("reload");
    expect(resolveDevConfig({ dev: { strategy: "manual" } }).strategy).toBe("manual");
    expect(() => resolveDevConfig({ dev: { strategy: "hot" as never } })).toThrow(
      'droplets: dev.strategy is "hot"; use "hmr", "remount", "reload", "manual"',
    );
  });

  it("accepts a custom element name and rejects invalid ones", () => {
    expect(resolveConfig({ element: "acme-widget" }).element).toBe("acme-widget");
    expect(resolveConfig({ element: "djs-svelte" }).element).toBe("djs-svelte");
    for (const bad of ["droplet", "Djs-Droplet", "1-x", "-x", "djs droplet", ""]) {
      expect(() => resolveConfig({ element: bad }), bad).toThrow(/not a valid custom element name/);
    }
  });

  it("lets PORT override both ports", () => {
    const user = { dev: { server: { port: 3000 } }, server: { port: 4000 } };
    expect(resolveDevConfig(user, { port: "9000" }).server.port).toBe(9000);
    expect(resolveConfig(user, { port: "9000" }).server.port).toBe(9000);
  });

  it("ignores a non-numeric PORT", () => {
    const resolved = resolveConfig({ server: { port: 4000 } }, { port: "nope" });
    expect(resolved.server.port).toBe(4000);
  });

  it("maps cors: true to a wildcard origin and passes objects through", () => {
    expect(resolveConfig({ cors: true }).cors).toEqual({ origin: "*" });
    expect(resolveConfig({ cors: false }).cors).toBeUndefined();
    const options = { origin: ["http://a.test"], credentials: true };
    expect(resolveConfig({ cors: options }).cors).toBe(options);
  });

  it("serves the import map automatically at /importmap, or where it is told", () => {
    expect(resolveConfig({}).importMap).toEqual({ path: "/importmap", auto: true });
    expect(resolveConfig({ importMap: "/vendor" }).importMap).toEqual({ path: "/vendor", auto: false });
    expect(resolveConfig({ importMap: false }).importMap).toBe(false);
    expect(resolveConfig({ warnImportMap: false }).warnImportMap).toBe(false);
    expect(() => resolveConfig({ importMap: "/droplets/map" })).toThrow(/importMap must be a path/);
  });

  it("refuses an import map and a health check on the same path", () => {
    expect(() => resolveConfig({ health: "/importmap" })).toThrow(/answer the same path/);
    expect(() => resolveConfig({ health: "/map.js", importMap: "/map" })).toThrow(/answer the same path/);
    expect(resolveConfig({ health: "/importmap", importMap: false }).health).toBe("/importmap");
  });

  it("defaults the health check to /health, and allows moving or disabling it", () => {
    expect(resolveConfig({}).health).toBe("/health");
    expect(resolveConfig({ health: "/healthz" }).health).toBe("/healthz");
    expect(resolveConfig({ health: false }).health).toBe(false);
  });

  it("rejects health paths the framework owns", () => {
    for (const bad of ["/", "health", "/index.js", "/index.css", "/droplets", "/droplets/x", "/assets/h", "/api/health", "/h?x", "/a b"]) {
      expect(() => resolveConfig({ health: bad }), bad).toThrow(/health must be a path/);
    }
    expect(resolveConfig({ health: "/apix" }).health).toBe("/apix");
  });

  it("normalises the API folder and keeps index as given", () => {
    expect(resolveConfig({}).apiFolder).toBe("src/api");
    expect(resolveConfig({ apiFolder: "./server/api/" }).apiFolder).toBe("server/api");
    expect(resolveConfig({}).index).toBeUndefined();
    expect(resolveConfig({ index: false }).index).toBe(false);
    expect(resolveConfig({ index: "./home.html" }).index).toBe("./home.html");
  });

  it("normalises the droplets folder", () => {
    expect(resolveConfig({ dropletsFolder: "./src/droplets/" }).dropletsFolder).toBe("src/droplets");
  });
});
