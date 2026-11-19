/**
 * The shop's layout stylesheet is one file copied into every host that
 * runs the shop (`examples/hosts/README.md`, "The shop demo"); a change
 * goes to all of them. WordPress's is a file of its own: its pages sit
 * inside the Twenty Twenty-Five theme and take its presets, as its header
 * says. Only the committed copies count: a local build leaves gitignored
 * ones behind (Spring's `target/`).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const hosts = resolve(import.meta.dirname, "../../../examples/hosts");

const copies = execFileSync("git", ["ls-files", "--", "*/shop.css"], { cwd: hosts, encoding: "utf8" }).split("\n").filter(Boolean).sort();

const read = (path: string) => readFileSync(join(hosts, path), "utf8");

describe("the shop's layout CSS across the hosts", () => {
  it("is in every host that runs the shop", () => {
    expect(copies.map((path) => path.split("/")[0])).toEqual([
      "aspnet",
      "astro",
      "django",
      "express",
      "fastapi",
      "go",
      "htmx",
      "laravel",
      "nextjs",
      "nginx",
      "php",
      "rails",
      "react-vite",
      "sinatra",
      "spring",
      "static",
      "sveltekit",
      "wordpress",
    ]);
  });

  it("is the same file in every host but WordPress", () => {
    const reference = read("express/public/shop.css");
    const differing = copies.filter((path) => !path.startsWith("wordpress/") && read(path) !== reference);
    expect(differing).toEqual([]);
  });

  it("is WordPress's own in WordPress, for the theme's presets", () => {
    const css = read("wordpress/plugin/droplets-embed/shop.css");
    expect(css).toContain("The shop's pages inside the theme (Twenty Twenty-Five)");
    expect(css).toContain("--wp--preset--");
    expect(css).not.toBe(read("express/public/shop.css"));
  });
});
