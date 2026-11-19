/**
 * Every host sends `x-droplet-location` as its public origin, written out
 * in its environment (`SHOP_PUBLIC_URL`, `DROPLETS_PUBLIC_URL`) or its
 * config: never the `Host` header of the browser's request, which a client
 * chooses (`examples/hosts/README.md`, "Two origins"). Per host, the files
 * that set the header, the value each line may give it and the line that
 * reads it from the environment; none of those files reads a host header.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { EXAMPLES } from "@dropletsjs/shared/hosts";
import { describe, expect, it } from "vitest";

const hosts = resolve(import.meta.dirname, "../../../examples/hosts");

type Host = {
  /** The files that send the header, relative to the host's folder. */
  files: string[];
  /** What a line setting the header may give it. */
  value: RegExp;
  /** Where that value comes from: the environment, read once. */
  source: RegExp[];
};

const HOSTS: Record<string, Host> = {
  express: {
    files: ["src/shop.js", "src/droplets.js", "src/server.js"],
    value: /"x-droplet-location": (?:origin|publicUrl)\b/,
    source: [/const origin = new URL\(publicUrl\)\.origin;/, /publicUrl: process\.env\.SHOP_PUBLIC_URL/],
  },
  sveltekit: {
    files: ["src/lib/shop.server.ts", "src/lib/droplets.server.ts", "src/lib/shop-page.server.ts"],
    value: /"x-droplet-location": (?:origin|DROPLETS_PUBLIC_URL)\b/,
    source: [
      /const origin = new URL\(publicUrl\)\.origin;/,
      /publicUrl: env\.SHOP_PUBLIC_URL/,
      /DROPLETS_PUBLIC_URL = env\.DROPLETS_PUBLIC_URL/,
    ],
  },
  nextjs: {
    files: ["lib/shop.ts", "lib/droplets.ts", "lib/shop-page.tsx"],
    value: /"x-droplet-location": (?:origin|DROPLETS_PUBLIC_URL)\b/,
    source: [
      /const origin = new URL\(publicUrl\)\.origin;/,
      /publicUrl: process\.env\.SHOP_PUBLIC_URL/,
      /process\.env\.DROPLETS_PUBLIC_URL/,
    ],
  },
  astro: {
    files: ["src/lib/shop.ts", "src/lib/droplets.ts", "src/lib/shop-page.ts", "src/middleware.ts"],
    value: /"x-droplet-location": (?:origin|DROPLETS_PUBLIC_URL)\b/,
    source: [
      /const origin = new URL\(publicUrl\)\.origin;/,
      /publicUrl: process\.env\.SHOP_PUBLIC_URL/,
      /process\.env\.DROPLETS_PUBLIC_URL/,
    ],
  },
  fastapi: {
    files: ["shop.py", "main.py"],
    value: /"x-droplet-location": (?:SHOP_ORIGIN|DROPLETS_PUBLIC_URL)\b/,
    source: [/os\.environ\.get\("SHOP_PUBLIC_URL"/, /DROPLETS_PUBLIC_URL = os\.environ\.get\("DROPLETS_PUBLIC_URL"/],
  },
  django: {
    files: ["config/settings.py", "shop/upstream.py", "shop/proxy.py", "shop/views.py", "basic/views.py"],
    value: /"x-droplet-location": (?:upstream\.SHOP_ORIGIN|DROPLETS_PUBLIC_URL)\b/,
    source: [/os\.environ\.get\("SHOP_PUBLIC_URL"/, /DROPLETS_PUBLIC_URL = os\.environ\.get\("DROPLETS_PUBLIC_URL"/],
  },
  sinatra: {
    files: ["shop.rb", "app.rb"],
    value: /"x-droplet-location" => (?:SHOP_ORIGIN|DROPLETS_PUBLIC_URL)\b/,
    source: [/ENV\.fetch\("SHOP_PUBLIC_URL"/, /DROPLETS_PUBLIC_URL = ENV\.fetch\("DROPLETS_PUBLIC_URL"/],
  },
  rails: {
    files: [
      "app/models/shop.rb",
      "app/controllers/home_controller.rb",
      "app/controllers/shop_controller.rb",
      "app/controllers/shop_proxy.rb",
    ],
    value: /"x-droplet-location" => (?:ORIGIN|DROPLETS_PUBLIC_URL)\b/,
    source: [/ENV\.fetch\("SHOP_PUBLIC_URL"/, /DROPLETS_PUBLIC_URL = ENV\.fetch\("DROPLETS_PUBLIC_URL"/],
  },
  aspnet: {
    files: ["src/HostSettings.cs", "src/Shop/ShopFragments.cs", "src/Shop/ShopProxy.cs", "src/Pages/Index.cshtml.cs"],
    value: /"x-droplet-location", settings\.(?:ShopOrigin|DropletsPublicUrl)\)/,
    source: [/ShopOrigin: OriginOf\(configuration\["SHOP_PUBLIC_URL"\]/, /DropletsPublicUrl: \(configuration\["DROPLETS_PUBLIC_URL"\]/],
  },
  spring: {
    files: [
      "src/main/java/com/example/droplets/Shop.java",
      "src/main/java/com/example/droplets/ShopProxy.java",
      "src/main/java/com/example/droplets/IndexController.java",
    ],
    value: /"x-droplet-location", (?:origin|dropletsPublicUrl)\)/,
    source: [/@Value\("\$\{SHOP_PUBLIC_URL:/, /@Value\("\$\{DROPLETS_PUBLIC_URL:/, /this\.origin = shop\.origin;/],
  },
  php: {
    files: ["app/shop.php", "public/index.php"],
    value: /'x-droplet-location' => (?:shop_origin\(\)|\$droplets_public)/,
    source: [/getenv\('SHOP_PUBLIC_URL'\)/, /\$droplets_public = rtrim\(getenv\('DROPLETS_PUBLIC_URL'\)/],
  },
  laravel: {
    files: ["app/Shop.php", "app/Http/Controllers/HomeController.php", "config/services.php"],
    value: /'x-droplet-location' => \$(?:this->origin|publicUrl)\b/,
    source: [
      /'public_url' => env\('SHOP_PUBLIC_URL'/,
      /'public_url' => env\('DROPLETS_PUBLIC_URL'/,
      /config\('services\.shop\.public_url'\)/,
      /\$publicUrl = rtrim\(\(string\) config\('services\.droplets\.public_url'\)/,
    ],
  },
  wordpress: {
    files: ["plugin/droplets-embed/shop.php", "plugin/droplets-embed/droplets-embed.php", "plugin/droplets-embed/shop-admin.php"],
    value: /'x-droplet-location'\]? (?:=>|=) (?:droplets_shop_public_origin\(\)|\$origin|droplets_public_url\(\))/,
    source: [/getenv\('SHOP_PUBLIC_URL'\)/, /getenv\('DROPLETS_PUBLIC_URL'\)/, /\$origin = droplets_shop_public_origin\(\);/],
  },
  "react-vite": {
    files: ["vite.config.ts", "nginx.conf"],
    value: /"x-droplet-location": publicUrl \}|x-droplet-location \$\{SHOP_PUBLIC_URL\};/,
    source: [/const publicUrl = env\["SHOP_PUBLIC_URL"\]/],
  },
  nginx: {
    files: ["nginx.conf", "iis/web.config"],
    value: /x-droplet-location \$\{(?:DROPLETS|SHOP)_PUBLIC_URL\};|name="HTTP_X_DROPLET_LOCATION" value="https:\/\/www\.example\.com"/,
    source: [/\$\{DROPLETS_PUBLIC_URL\}/, /\$\{SHOP_PUBLIC_URL\}/],
  },
  go: {
    files: ["shop.go", "main.go"],
    value: /\.Set\("x-droplet-location", (?:s\.origin|b\.publicURL)\)/,
    source: [/getenv\("SHOP_PUBLIC_URL", /, /getenv\("DROPLETS_PUBLIC_URL", /],
  },
  htmx: {
    files: ["nginx.conf"],
    value: /x-droplet-location \$\{SHOP_PUBLIC_URL\};/,
    source: [/\$\{SHOP_PUBLIC_URL\}/],
  },
};

/** Hosts whose browser asks the droplets server itself, with no proxy and no fragment fetched on a server: nothing sends the header. */
const NONE = ["static"];

describe("every host example", () => {
  it("is listed here, with the files that send the header or as sending none", () => {
    const listed = [...Object.keys(HOSTS), ...NONE].sort();
    expect(listed).toEqual(EXAMPLES.map((host) => host.id).sort());
  });

  it.each(NONE)("%s sends no x-droplet-location", (host) => {
    // Its docs say it sends none; only the files that run are read.
    const files = readdirSync(join(hosts, host), { recursive: true, withFileTypes: true }).filter(
      (entry) => entry.isFile() && !entry.name.endsWith(".md"),
    );
    const sending = files.filter((entry) => /x-droplet-location/i.test(readFileSync(join(entry.parentPath, entry.name), "utf8")));
    expect(sending.map((entry) => entry.name)).toEqual([]);
  });
});

/** A read of the request's own host, in any of the hosts' languages. */
const HOST_HEADER =
  /\.headers\.host\b|headers\.get\(["']host["']\)|req\.get\(["']host["']\)|req\.hostname|request\.headers\[["']host["']\]|request\.headers\.get\(["']host["']\)|request\.host\b|request\.base_url|\.get_host\(|build_absolute_uri|HTTP_HOST\b|\$host\b|\$http_host\b|\$server_name\b|\{HTTP_HOST\}|\br\.Host\b|\.Header\.Get\(["']host["']\)/i;

const isComment = (line: string) => /^\s*(?:\/\/|\*|\/\*|#|<!--)/.test(line);

/** Block comments and Python docstrings blanked, their line breaks kept so a report's line numbers stay right. */
const withoutBlockComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->|"""[\s\S]*?"""/g, (block) => block.replace(/[^\n]/g, ""));

describe.each(Object.entries(HOSTS))("%s sends its own public origin as x-droplet-location", (host, { files, value, source }) => {
  const texts = files.map((file) => [file, withoutBlockComments(readFileSync(join(hosts, host, file), "utf8"))] as const);

  it("sets the header from the written-out origin on every line that sets it", () => {
    const lines = texts.flatMap(([file, text]) =>
      text
        .split("\n")
        .map((line, index) => ({ at: `${file}:${index + 1}`, line }))
        .filter(({ line }) => /x-droplet-location/i.test(line) && !isComment(line)),
    );
    expect(lines.length, "lines setting the header").toBeGreaterThan(0);
    expect(lines.filter(({ line }) => !value.test(line)).map(({ at, line }) => `${at}: ${line.trim()}`)).toEqual([]);
  });

  it("reads that origin from the environment", () => {
    const all = texts.map(([, text]) => text).join("\n");
    expect(source.filter((pattern) => !pattern.test(all)).map(String)).toEqual([]);
  });

  it("never reads the request's Host", () => {
    const found = texts.flatMap(([file, text]) =>
      text
        .split("\n")
        .map((line, index) => ({ at: `${file}:${index + 1}`, line }))
        .filter(({ line }) => !isComment(line) && HOST_HEADER.test(line))
        .map(({ at, line }) => `${at}: ${line.trim()}`),
    );
    expect(found).toEqual([]);
  });
});
