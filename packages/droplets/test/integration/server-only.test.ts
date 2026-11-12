/**
 * Server files never reach a browser bundle: a `*.server.*` file or one
 * under a `server/` folder, reached from client code through any chain,
 * fails a real `vite build` and the dev server. Server code may import them.
 */
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createBuilder, createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fakeRenderer } from "../../src/testing/index.ts";
import { droplets, type DropletsAdapter } from "../../src/vite.ts";
import { isServerOnlyFile } from "../../src/vite/server-only.ts";

const fixtures = fileURLToPath(new URL("../fixtures/", import.meta.url));

const fakeAdapter: DropletsAdapter = {
  name: "fake",
  serverEntry: resolve(fixtures, "app/fake-entry.js"),
  serverFile: "server.js",
  separateSsrBundle: true,
};

const SECRET = "export const secret = 'sk_live_do_not_ship';\n";

/** A project with one droplet, `card`, and the given files (paths from the project root). */
async function project(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(fixtures, ".server-only-"));
  const all: Record<string, string> = {
    "src/droplets/card/+droplet.fake.js": "export default () => `<p>card</p>`;\n",
    ...files,
  };
  for (const [path, text] of Object.entries(all)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

const build = (root: string) =>
  createBuilder({
    root,
    configFile: false,
    logLevel: "silent",
    plugins: [droplets({ adapter: fakeAdapter, renderers: [fakeRenderer()] })],
  }).then((builder) => builder.buildApp());

const roots: string[] = [];
afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

async function built(files: Record<string, string>): Promise<string> {
  const root = await project(files);
  roots.push(root);
  return root;
}

describe("isServerOnlyFile", () => {
  const server = (path: string) => isServerOnlyFile({ root: "/proj", id: `/proj/${path}` });

  it("takes .server. with any extension, +server.* routes and server/ folders", () => {
    for (const path of ["src/lib/db.server.tsx", "src/lib/a.server.mjs", "src/lib/x.server.cts", "src/server/x.ts", "src/api/+server.ts"]) {
      expect(server(path), path).toBe(true);
    }
  });

  it("ignores case in the name and the folder", () => {
    for (const path of [
      "src/lib/Server/db.ts",
      "src/SERVER/x.ts",
      "src/lib/foo.SERVER.ts",
      "src/lib/db.Server.tsx",
      "src/api/+Server.ts",
    ]) {
      expect(server(path), path).toBe(true);
    }
  });

  it("does not take a name or folder that merely ends or starts with server", () => {
    for (const path of ["src/lib/observer.ts", "src/lib/webserver.js", "src/myserver/x.ts", "src/server-utils/x.ts", "src/server.tsx"]) {
      expect(server(path), path).toBe(false);
    }
  });
});

const USES_SERVER = "import { json } from '$droplets/server';\nexport const reply = () => json({ ok: true });\n";

describe("server files in the client build", () => {
  it("fails when +droplet.ts imports a *.server.ts file", async () => {
    const root = await built({
      "src/droplets/card/+droplet.ts": "import { secret } from './db.server.ts';\nexport const load = () => ({ n: secret.length });\n",
      "src/droplets/card/db.server.ts": SECRET,
    });
    await expect(build(root)).rejects.toThrow(
      /droplets: src\/droplets\/card\/db\.server\.ts is server code and cannot reach the browser: .*src\/droplets\/card\/\+droplet\.ts -> src\/droplets\/card\/db\.server\.ts/,
    );
  }, 90_000);

  it("fails when a component imports a file under a server/ folder", async () => {
    const root = await built({
      "src/droplets/card/+droplet.fake.js":
        "import { secret } from '../../lib/server/keys.js';\nexport default () => `<p>${secret.length}</p>`;\n",
      "src/lib/server/keys.js": SECRET,
    });
    await expect(build(root)).rejects.toThrow(/src\/lib\/server\/keys\.js is server code/);
  }, 90_000);

  it("fails on a Server/ folder or a *.SERVER.* name in any case", async () => {
    const folder = await built({
      "src/droplets/card/+droplet.fake.js":
        "import { secret } from '../../lib/Server/keys.js';\nexport default () => `<p>${secret.length}</p>`;\n",
      "src/lib/Server/keys.js": SECRET,
    });
    await expect(build(folder)).rejects.toThrow(/src\/lib\/Server\/keys\.js is server code/);
    const name = await built({
      "src/droplets/card/+droplet.ts": "import { secret } from './db.SERVER.ts';\nexport const load = () => ({ n: secret.length });\n",
      "src/droplets/card/db.SERVER.ts": SECRET,
    });
    await expect(build(name)).rejects.toThrow(/src\/droplets\/card\/db\.SERVER\.ts is server code/);
  }, 90_000);

  it("fails through a chain of neutral modules, naming every step", async () => {
    const root = await built({
      "src/droplets/card/+droplet.ts": "import { n } from '../../lib/util.ts';\nexport const load = () => ({ n });\n",
      "src/lib/util.ts": "import { secret } from './query.server.js';\nexport const n = secret.length;\n",
      "src/lib/query.server.js": SECRET,
    });
    await expect(build(root)).rejects.toThrow(/src\/droplets\/card\/\+droplet\.ts -> src\/lib\/util\.ts -> src\/lib\/query\.server\.js/);
  }, 90_000);

  it("builds when only server code imports them, and the secret stays out of the client", async () => {
    const root = await built({
      "src/droplets/card/+droplet.server.ts":
        "import { secret } from './db.server.ts';\nimport { n } from '../../lib/server/count.ts';\nexport const load = () => ({ n: secret.length + n });\n",
      "src/droplets/card/db.server.ts": SECRET,
      "src/lib/server/count.ts": "export const n = 1;\n",
    });
    await build(root);
    const client = join(root, "dist/client/droplets/card/client.js");
    expect(existsSync(client)).toBe(true);
    expect(await readFile(client, "utf8")).not.toContain("sk_live_do_not_ship");
  }, 90_000);

  it("fails when server code reaches $droplets/server through a name that only ends in server", async () => {
    const root = await built({
      "src/droplets/card/+droplet.server.ts":
        "import { reply } from '../../lib/observer.ts';\nexport const load = () => ({ ok: typeof reply });\n",
      "src/lib/observer.ts": USES_SERVER,
    });
    await expect(build(root)).rejects.toThrow(/\$droplets\/server can only be imported by server files.*src\/lib\/observer\.ts/);
  }, 90_000);

  it("fails when a component imports the bare @dropletsjs/droplets/server, naming the importer", async () => {
    const root = await built({
      "src/droplets/card/+droplet.fake.js":
        "import { error } from '@dropletsjs/droplets/server';\nexport default () => `<p>${typeof error}</p>`;\n",
    });
    await expect(build(root)).rejects.toThrow(
      /@dropletsjs\/droplets\/server can only be imported by server files.*src\/droplets\/card\/\+droplet\.fake\.js/,
    );
  }, 90_000);

  it("lets *.server.* with any extension and server/ files import $droplets/server, and client code import look-alikes", async () => {
    const root = await built({
      "src/droplets/card/+droplet.server.ts": [
        "import { reply as a } from './db.server.tsx';",
        "import { reply as b } from './a.server.mjs';",
        "import { reply as c } from './x.server.cts';",
        "import { reply as d } from '../../server/x.ts';",
        "export const load = () => ({ n: [a, b, c, d].length });",
        "",
      ].join("\n"),
      "src/droplets/card/db.server.tsx": USES_SERVER,
      "src/droplets/card/a.server.mjs": USES_SERVER,
      "src/droplets/card/x.server.cts": USES_SERVER,
      "src/server/x.ts": USES_SERVER,
      "src/droplets/card/+droplet.ts": [
        "import { a } from '../../lib/observer.ts';",
        "import { b } from '../../lib/webserver.js';",
        "import { c } from '../../myserver/x.ts';",
        "import { d } from '../../server-utils/x.ts';",
        "export const load = ({ data }) => ({ ...data, s: a + b + c + d });",
        "",
      ].join("\n"),
      "src/lib/observer.ts": "export const a = 'a';\n",
      "src/lib/webserver.js": "export const b = 'b';\n",
      "src/myserver/x.ts": "export const c = 'c';\n",
      "src/server-utils/x.ts": "export const d = 'd';\n",
    });
    await build(root);
    expect(existsSync(join(root, "dist/client/droplets/card/client.js"))).toBe(true);
  }, 90_000);

  it("fails when a client chain through observer.ts reaches a *.server.tsx file", async () => {
    const root = await built({
      "src/droplets/card/+droplet.ts": "import { n } from '../../lib/observer.ts';\nexport const load = () => ({ n });\n",
      "src/lib/observer.ts": "import { secret } from './keys.server.tsx';\nexport const n = secret.length;\n",
      "src/lib/keys.server.tsx": SECRET,
    });
    await expect(build(root)).rejects.toThrow(
      /src\/droplets\/card\/\+droplet\.ts -> src\/lib\/observer\.ts -> src\/lib\/keys\.server\.tsx/,
    );
  }, 90_000);

  it("fails when src/hooks.client.ts imports a *.server.ts file", async () => {
    const root = await built({
      "src/hooks.client.ts": "import { secret } from './lib/session.server.ts';\nexport const init = () => { void secret; };\n",
      "src/lib/session.server.ts": SECRET,
    });
    await expect(build(root)).rejects.toThrow(
      /droplets: src\/lib\/session\.server\.ts is server code and cannot reach the browser: .*src\/hooks\.client\.ts -> src\/lib\/session\.server\.ts/,
    );
  }, 90_000);

  it("fails when src/hooks.client.ts reaches a file under a server/ folder through a neutral module", async () => {
    const root = await built({
      "src/hooks.client.js": "import { n } from './lib/util.js';\nexport function init() { void n; }\n",
      "src/lib/util.js": "import { secret } from './server/keys.js';\nexport const n = secret.length;\n",
      "src/lib/server/keys.js": SECRET,
    });
    await expect(build(root)).rejects.toThrow(/src\/hooks\.client\.js -> src\/lib\/util\.js -> src\/lib\/server\/keys\.js/);
  }, 90_000);

  describe("reached as a file, not a module", () => {
    const LARGE = `export const secret = ${JSON.stringify("sk_live_do_not_ship".repeat(400))};\n`;

    it("fails on new URL(…, import.meta.url) of a server file, inlined as data: or emitted as an asset", async () => {
      const inlined = await built({
        "src/droplets/card/+droplet.fake.js":
          "const url = new URL('../../lib/server/keys.js', import.meta.url);\nexport default () => `<a href=${url}>card</a>`;\n",
        "src/lib/server/keys.js": SECRET,
      });
      await expect(build(inlined)).rejects.toThrow(/src\/lib\/server\/keys\.js is server code and cannot reach the browser/);
      const emitted = await built({
        "src/droplets/card/+droplet.fake.js":
          "const url = new URL('./keys.server.js', import.meta.url);\nexport default () => `<a href=${url}>card</a>`;\n",
        "src/droplets/card/keys.server.js": LARGE,
      });
      await expect(build(emitted)).rejects.toThrow(/src\/droplets\/card\/keys\.server\.js is server code and cannot reach the browser/);
    }, 90_000);

    it("fails on ?url, ?raw and ?inline imports of a server file", async () => {
      for (const query of ["?url", "?raw", "?inline"]) {
        const root = await built({
          "src/droplets/card/+droplet.fake.js": `import value from './keys.server.txt${query}';\nexport default () => \`<p>\${value}</p>\`;\n`,
          "src/droplets/card/keys.server.txt": "sk_live_do_not_ship\n",
        });
        await expect(build(root), query).rejects.toThrow(
          /src\/droplets\/card\/keys\.server\.txt is server code and cannot reach the browser/,
        );
      }
    }, 120_000);

    it("fails on a CSS url() of a server file", async () => {
      const root = await built({
        "src/droplets/card/+droplet.fake.js": "import './card.css';\nexport default () => `<p class=card>card</p>`;\n",
        "src/droplets/card/card.css": ".card { background: url(../../lib/server/bg.svg); }\n",
        "src/lib/server/bg.svg": "<svg xmlns='http://www.w3.org/2000/svg'><text>sk_live_do_not_ship</text></svg>\n",
      });
      await expect(build(root)).rejects.toThrow(/src\/lib\/server\/bg\.svg is server code and cannot reach the browser/);
    }, 90_000);

    it("builds a look-alike referenced as a file", async () => {
      const root = await built({
        "src/droplets/card/+droplet.fake.js":
          "import raw from '../../lib/observer.txt?raw';\nconst url = new URL('../../lib/webserver.svg', import.meta.url);\nexport default () => `<p>${raw}${url}</p>`;\n",
        "src/lib/observer.txt": "ok\n",
        "src/lib/webserver.svg": "<svg xmlns='http://www.w3.org/2000/svg'/>\n",
      });
      await build(root);
      expect(existsSync(join(root, "dist/client/droplets/card/client.js"))).toBe(true);
    }, 90_000);
  });

  it("fails when src/hooks.client.ts imports $droplets/env/private", async () => {
    const root = await built({
      "src/hooks.client.ts": "import { env } from '$droplets/env/private';\nexport const init = () => { void env; };\n",
    });
    await expect(build(root)).rejects.toThrow(/\$droplets\/env\/private can only be imported by server files/);
  }, 90_000);

  describe("in vite dev", () => {
    let server: ViteDevServer;
    let root: string;

    beforeAll(async () => {
      root = await built({
        "src/droplets/card/+droplet.ts": "import { secret } from './db.server.ts';\nexport const load = () => ({ n: secret.length });\n",
        "src/droplets/card/db.server.ts": SECRET,
        "src/droplets/card/view.js": "import { n } from '../../lib/server/count.js';\nexport const view = n;\n",
        "src/lib/server/count.js": "export const n = 1;\n",
        "src/droplets/card/watch.js": "import { n } from '../../lib/observer.ts';\nexport const watch = n;\n",
        "src/lib/observer.ts": "import { secret } from './keys.server.tsx';\nexport const n = secret.length;\n",
        "src/lib/keys.server.tsx": SECRET,
        "src/lib/webserver.js": USES_SERVER,
        "src/lib/reply.server.mjs": USES_SERVER,
        "src/hooks.client.ts": "import { secret } from './lib/session.server.ts';\nexport const init = () => { void secret; };\n",
        "src/lib/session.server.ts": SECRET,
        "src/droplets/card/upper.js": "import { n } from '../../shared/SERVER/count.js';\nexport const upper = n;\n",
        "src/shared/SERVER/count.js": "export const n = 1;\n",
        "src/droplets/card/mixed.js": "import { secret } from './keys.Server.ts';\nexport const mixed = secret;\n",
        "src/droplets/card/keys.Server.ts": SECRET,
        "src/lib/server/secret.txt": "sk_live_do_not_ship\n",
        "src/droplets/card/bare.js": "import { error } from '@dropletsjs/droplets/server';\nexport const bare = typeof error;\n",
      });
      server = await createServer({
        root,
        configFile: false,
        logLevel: "silent",
        plugins: [droplets({ renderers: [fakeRenderer()] })],
        server: { middlewareMode: true, hmr: false, watch: null },
      });
    }, 60_000);

    afterAll(async () => {
      await server?.close();
    });

    it("refuses a *.server.ts import as it resolves", async () => {
      await expect(server.environments.client.transformRequest("/src/droplets/card/+droplet.ts")).rejects.toThrow(
        /src\/droplets\/card\/db\.server\.ts is server code and cannot reach the browser: src\/droplets\/card\/\+droplet\.ts -> src\/droplets\/card\/db\.server\.ts/,
      );
    });

    it("refuses the bare @dropletsjs/droplets/server from a client module as it resolves", async () => {
      await expect(server.environments.client.transformRequest("/src/droplets/card/bare.js")).rejects.toThrow(
        /@dropletsjs\/droplets\/server can only be imported by server files.*src\/droplets\/card\/bare\.js/,
      );
    });

    it("refuses a server/ folder import", async () => {
      await expect(server.environments.client.transformRequest("/src/droplets/card/view.js")).rejects.toThrow(
        /src\/lib\/server\/count\.js is server code/,
      );
    });

    it("refuses a SERVER/ folder and a *.Server.* name, in any case", async () => {
      await expect(server.environments.client.transformRequest("/src/droplets/card/upper.js")).rejects.toThrow(
        /src\/shared\/SERVER\/count\.js is server code/,
      );
      await expect(server.environments.client.transformRequest("/src/droplets/card/mixed.js")).rejects.toThrow(
        /src\/droplets\/card\/keys\.Server\.ts is server code/,
      );
    });

    it("lets client code import observer.ts, and refuses the server file behind it", async () => {
      await expect(server.environments.client.transformRequest("/src/droplets/card/watch.js")).resolves.toBeTruthy();
      await expect(server.environments.client.transformRequest("/src/lib/observer.ts")).rejects.toThrow(
        /src\/droplets\/card\/watch\.js -> src\/lib\/observer\.ts -> src\/lib\/keys\.server\.tsx/,
      );
    });

    it("refuses $droplets/server to a name that only ends in server, on the server too", async () => {
      await expect(server.environments.ssr.transformRequest("/src/lib/webserver.js")).rejects.toThrow(
        /\$droplets\/server can only be imported by server files/,
      );
      await expect(server.environments.ssr.transformRequest("/src/lib/reply.server.mjs")).resolves.toBeTruthy();
    });

    it("refuses a server file imported by src/hooks.client.ts", async () => {
      await expect(server.environments.client.transformRequest("/src/hooks.client.ts")).rejects.toThrow(
        /src\/lib\/session\.server\.ts is server code and cannot reach the browser: .*src\/hooks\.client\.ts -> src\/lib\/session\.server\.ts/,
      );
    });

    it("lets the SSR environment import them", async () => {
      await expect(server.environments.ssr.transformRequest("/src/droplets/card/+droplet.ts")).resolves.toBeTruthy();
    });

    it("refuses a server file asked for directly, with any query", async () => {
      for (const url of [
        "/src/droplets/card/db.server.ts",
        "/src/droplets/card/db.server.ts?raw",
        "/src/droplets/card/db.server.ts?url",
        "/src/lib/server/count.js",
        "/src/shared/SERVER/count.js?import",
      ]) {
        await expect(server.environments.client.transformRequest(url), url).rejects.toThrow(/is server code and cannot reach the browser/);
      }
      await expect(server.environments.ssr.transformRequest("/src/lib/server/count.js?raw")).resolves.toBeTruthy();
    });

    it("refuses a server file the browser fetches as a file", async () => {
      const listening = await createServer({
        root,
        configFile: false,
        logLevel: "silent",
        plugins: [droplets({ renderers: [fakeRenderer()] })],
        server: { port: 0, host: "127.0.0.1", hmr: false, watch: null },
      });
      await listening.listen();
      try {
        const base = listening.resolvedUrls?.local[0] ?? expect.unreachable("a dev server URL");
        for (const path of [
          "/src/droplets/card/db.server.ts",
          "/src/lib/server/count.js?t=1",
          "/src/lib/keys.server.tsx",
          "/src/shared/SERVER/count.js",
          "/src/lib/server/secret.txt",
          "/src/lib/%73erver/secret.txt",
        ]) {
          const res = await fetch(new URL(path, base));
          expect(res.status, path).toBe(403);
          expect(await res.text(), path).not.toContain("sk_live_do_not_ship");
        }
        expect((await fetch(new URL("/src/droplets/card/+droplet.fake.js", base))).status).toBe(200);
      } finally {
        await listening.close();
      }
    }, 30_000);
  });
});
