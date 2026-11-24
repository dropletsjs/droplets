/**
 * Every host treats a fragment's 504 as it treats a 500: both carry the droplet's error
 * page (`+error.*`, `text/html`), the 504 when the render ran past the server's
 * `render.timeout` (5 s by default). So wherever a host accepts a 500 it accepts a 504 on
 * the same line, and every timer that bounds a wait for a fragment or a `_data` read is
 * 10 s or more: the host waits longer than the droplets server does, and gets its error
 * page. Connect timeouts race no render and are not read.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { EXAMPLES } from "@dropletsjs/shared/hosts";
import { describe, expect, it } from "vitest";

const hosts = resolve(import.meta.dirname, "../../../examples/hosts");

type Host = {
  /** The files that fetch fragments or `_data`, relative to the host's folder. */
  files: string[];
  /** How many lines accept a 500 and a 504 as a fragment. */
  checks: number;
  /** How many response timers those files set. */
  timers: number;
  /** A line that sends a 500 of the host's own, not a check of the shop's. */
  own?: RegExp;
};

const HOSTS: Record<string, Host> = {
  express: { files: ["src/droplets.js", "src/shop.js"], checks: 2, timers: 4 },
  sveltekit: { files: ["src/lib/droplets.server.ts", "src/lib/shop.server.ts"], checks: 2, timers: 4 },
  nextjs: { files: ["lib/droplets.ts", "lib/shop.ts"], checks: 2, timers: 4 },
  astro: { files: ["src/lib/droplets.ts", "src/lib/shop.ts"], checks: 2, timers: 4 },
  "react-vite": { files: ["src/droplets.tsx", "src/shop/ShopDroplet.tsx"], checks: 2, timers: 0 },
  static: { files: ["html/shop.js"], checks: 1, timers: 0 },
  fastapi: { files: ["main.py", "shop.py"], checks: 2, timers: 2 },
  django: { files: ["basic/views.py", "shop/views.py", "shop/upstream.py"], checks: 2, timers: 2 },
  php: { files: ["public/index.php", "app/shop.php", "app/http.php"], checks: 2, timers: 5 },
  laravel: { files: ["app/Http/Controllers/HomeController.php", "app/Shop.php"], checks: 2, timers: 4 },
  wordpress: { files: ["plugin/droplets-embed/droplets-embed.php", "plugin/droplets-embed/shop.php"], checks: 2, timers: 4 },
  sinatra: { files: ["app.rb", "shop.rb"], checks: 2, timers: 2 },
  rails: { files: ["app/controllers/home_controller.rb", "app/models/shop.rb"], checks: 2, timers: 2 },
  aspnet: { files: ["src/Pages/Index.cshtml.cs", "src/Shop/ShopFragments.cs", "src/HostApp.cs"], checks: 2, timers: 3 },
  spring: {
    files: [
      "src/main/java/com/example/droplets/IndexController.java",
      "src/main/java/com/example/droplets/Shop.java",
      "src/main/java/com/example/droplets/Application.java",
    ],
    checks: 2,
    timers: 2,
  },
  go: { files: ["main.go", "shop.go"], checks: 1, timers: 5, own: /http\.Error\(/ },
};

/** nginx pastes through SSI and decides in its config; htmx swaps a 2xx only, so a 500 and a 504 both get its note. */
const CONFIGURED = ["nginx", "htmx"];

const NAMES_500 = /\b500\b|StatusInternalServerError/;
const NAMES_504 = /\b504\b|StatusGatewayTimeout/;

/** A response timer and its value in milliseconds, in each of the hosts' languages. */
const TIMERS: [RegExp, number][] = [
  [/AbortSignal\.timeout\(([\d_]+)\)/g, 1],
  [/\btimeout=([\d.]+)/g, 1000],
  [/\bread_timeout: ([\d.]+)/g, 1000],
  [/'timeout' => (\d+)/g, 1000],
  [/->timeout\((\d+)\)/g, 1000],
  [/->client\(.*, (\d+)\)(?=->|$)/gm, 1000],
  [/(?<!\[)\](?:, \$\w+\))?, (\d+)\);$|int \$timeout = (\d+)/gm, 1000],
  [/TimeSpan\.FromSeconds\((\d+)\)/g, 1000],
  [/restClient\(Duration\.ofSeconds\((\d+)\)\)/g, 1000],
  [/\b(\d+) ?\* ?time\.Second\b/g, 1000],
];

const isComment = (line: string) => /^\s*(?:\/\/|\*|\/\*|#|<!--)/.test(line);

/** Block comments and Python docstrings blanked, their line breaks kept so a report's line numbers stay right. */
const withoutBlockComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->|"""[\s\S]*?"""/g, (block) => block.replace(/[^\n]/g, ""));

/** The code alone: every comment line blanked. */
const code = (text: string) =>
  withoutBlockComments(text)
    .split("\n")
    .map((line) => (isComment(line) ? "" : line))
    .join("\n");

describe("every host example", () => {
  it("is listed here, with the files that fetch fragments or as configured", () => {
    const listed = [...Object.keys(HOSTS), ...CONFIGURED].sort();
    expect(listed).toEqual(EXAMPLES.map((host) => host.id).sort());
  });
});

describe.each(Object.entries(HOSTS))("%s pastes a 504 fragment as it pastes a 500", (host, { files, checks, timers, own }) => {
  const texts = files.map((file) => [file, code(readFileSync(join(hosts, host, file), "utf8"))] as const);
  const lines = texts.flatMap(([file, text]) => text.split("\n").map((line, index) => ({ at: `${file}:${index + 1}`, line })));

  it("accepts a 504 on every line that accepts a 500", () => {
    const named = lines.filter(({ line }) => NAMES_500.test(line) && !own?.test(line));
    expect(named.filter(({ line }) => !NAMES_504.test(line)).map(({ at, line }) => `${at}: ${line.trim()}`)).toEqual([]);
    expect(named.length, "lines accepting a 500 and a 504").toBe(checks);
  });

  it("waits 10 s or more for every fragment and _data answer", () => {
    const found = texts.flatMap(([file, text]) =>
      TIMERS.flatMap(([pattern, unit]) =>
        [...text.matchAll(pattern)].map((match) => {
          const value = match.slice(1).find((group) => group !== undefined) ?? "";
          return { at: file, text: match[0].trim(), ms: Number(value.replaceAll("_", "")) * unit };
        }),
      ),
    );
    expect(found.length, "timers found").toBe(timers);
    expect(found.filter(({ ms }) => !(ms >= 10_000)).map(({ at, text }) => `${at}: ${text}`)).toEqual([]);
  });
});

describe("nginx pastes a 504 fragment as it pastes a 500", () => {
  const conf = readFileSync(join(hosts, "nginx/nginx.conf"), "utf8");
  const fragment = /location \^~ \/_fragment\/ \{([\s\S]*?)\n {2}\}/.exec(conf)?.[1] ?? "";

  it("leaves the shop's 500 and 504 out of the fragments' error_page", () => {
    const codes = [...fragment.matchAll(/^\s*error_page ([\d ]+)=/gm)].flatMap((match) => match[1]?.trim().split(/\s+/) ?? []);
    expect(codes.length).toBeGreaterThan(0);
    expect(codes.filter((status) => status.startsWith("5"))).toEqual([]);
    expect(fragment).toMatch(/^\s*proxy_intercept_errors on;/m);
  });

  it("answers nginx's own failures from a backup, after waiting 10 s", () => {
    const upstream = /^\s*proxy_pass http:\/\/(\w+);/m.exec(fragment)?.[1];
    const block = new RegExp(`upstream ${upstream} \\{([^}]*)\\}`).exec(conf)?.[1] ?? "";
    expect(block).toMatch(/^\s*server shop:8300 max_fails=0;/m);
    expect(block).toMatch(/^\s*server 127\.0\.0\.1:(\d+) backup;/m);
    const port = /127\.0\.0\.1:(\d+) backup/.exec(block)?.[1];
    expect(conf).toContain(`listen 127.0.0.1:${port};\n  default_type text/html;\n  return 200 '<p class="shop-unavailable">`);
    expect(fragment).toMatch(/^\s*proxy_read_timeout 10s;/m);
  });
});

describe("htmx swaps a 2xx alone, so a 500 and a 504 both get its note", () => {
  const shop = readFileSync(join(hosts, "htmx/html/shop.js"), "utf8");

  it("writes the note on htmx:responseError and lets htmx keep its default for errors", () => {
    expect(shop).toContain('document.addEventListener("htmx:responseError"');
    expect(shop).not.toMatch(/responseHandling|shouldSwap/);
  });
});
