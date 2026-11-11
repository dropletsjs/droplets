// @vitest-environment happy-dom
import { existsSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { readExportedFlags, validateRenderers } from "@dropletsjs/droplets";
import type { ClientRenderContext, DropletChildrenHost, ServerRenderContext } from "@dropletsjs/droplets";
import { defineComponent, h, nextTick, ref } from "vue";
import { vue } from "../src/index.ts";
import { DropletChildren } from "../src/children.ts";
import { render } from "../src/server.ts";
import { hydrate, mount, unmount } from "../src/client.ts";

describe("vue()", () => {
  it("claims .vue and points at its built server and client modules", () => {
    const renderer = vue();
    expect(renderer.name).toBe("vue");
    expect(renderer.extensions).toEqual([".vue"]);
    expect(validateRenderers([renderer]).get(".vue")).toEqual([renderer]);
    expect(renderer.server).toMatch(/[\\/]dist[\\/]server\.js$/);
    expect(renderer.client).toMatch(/[\\/]dist[\\/]client\.js$/);
    expect(existsSync(renderer.server), "build the package first").toBe(true);
    expect(existsSync(renderer.client)).toBe(true);
    expect(renderer.plugins).toHaveLength(1);
  });

  it("leaves the Vite plugin out when asked", () => {
    expect(vue({ plugin: false }).plugins).toBeUndefined();
  });

  it("forwards plugin options", () => {
    // The plugin is opaque; what matters is that the options reach it without throwing.
    expect(vue({ vitePlugin: { features: { customElement: /\.ce\.vue$/ } } }).plugins).toHaveLength(1);
    expect(vue({ vitePlugin: { customElement: true } }).plugins).toHaveLength(1);
  });

  it("reads flags from a plain <script> block with the default reader", () => {
    const source = [
      `<script lang="ts">`,
      `export const ssr = false;`,
      `export const prerender = true;`,
      `</script>`,
      `<script setup lang="ts">`,
      `defineProps<{ data: unknown }>();`,
      `</script>`,
      `<template><p>{{ data }}</p></template>`,
    ].join("\n");
    expect(readExportedFlags(source, "x")).toEqual({ ssr: false, prerender: true });
    expect(vue().readFlags).toBeUndefined();
  });
});

const serverContext = (kind: ServerRenderContext["kind"] = "droplet"): ServerRenderContext => ({
  droplet: "hello",
  kind,
  renderId: "r1",
  actionUrl: () => "/droplets/hello",
});

/** A component like a compiled `+droplet.vue` with a scoped style. */
const Scoped = defineComponent({
  __scopeId: "data-v-test",
  props: { data: { type: Object, required: true } },
  setup(props: { data: { greeting: string } }) {
    return () => h("section", [h("h1", props.data.greeting), h("div", { class: "kids" }, [h(DropletChildren)])]);
  },
});

describe("render()", () => {
  it("renders the component with data and the bare children marker, unscoped", async () => {
    const html = await render({ default: Scoped }, { data: { greeting: "Hi" } }, serverContext());
    expect(html).toBe(
      `<section data-v-test><h1 data-v-test>Hi</h1><div class="kids" data-v-test><!--[--><div data-droplet-children style="display: contents"></div><!--]--></div></section>`,
    );
  });

  it("returns an error page's inlined styles as head", async () => {
    const ErrorComponent = defineComponent({
      styles: [".oops{color:crimson}"],
      props: { error: { type: Object, required: true } },
      setup(props: { error: { message: string } }) {
        return () => h("p", { class: "oops" }, props.error.message);
      },
    });
    const out = await render({ default: ErrorComponent }, { error: { message: "no" } }, serverContext("error"));
    expect(out).toEqual({ html: `<p class="oops">no</p>`, head: `<style>.oops{color:crimson}</style>` });
    // A droplet never gets a head.
    expect(await render({ default: ErrorComponent }, { error: { message: "no" } }, serverContext())).toBe(`<p class="oops">no</p>`);
  });

  it("rejects a module without a component", async () => {
    await expect(render({}, { data: {} }, serverContext())).rejects.toThrow(/not a Vue component/);
  });
});

function clientContext(host: DropletChildrenHost, markers: Element[] = [], kind: ClientRenderContext["kind"] = "droplet") {
  return {
    droplet: "hello",
    kind,
    children: host,
    renderId: "r1",
    markers: () => markers,
    actionUrl: () => "/droplets/hello",
  } satisfies ClientRenderContext;
}

function fakeHost() {
  return { fill: vi.fn<DropletChildrenHost["fill"]>(), empty: vi.fn<DropletChildrenHost["empty"]>() };
}

describe("DropletChildren in the browser", () => {
  it("renders the marker in light DOM, fills it when mounted and empties it before unmount", async () => {
    const target = document.createElement("div");
    document.body.appendChild(target);
    const host = fakeHost();
    const app = mount({ default: Scoped }, target, { data: { greeting: "Hi" } }, clientContext(host));
    const marker = target.querySelector<HTMLElement>("div.kids > [data-droplet-children]");
    expect(marker).not.toBeNull();
    expect(marker?.style.display).toBe("contents");
    expect(marker?.hasAttribute("data-v-test")).toBe(false);
    expect(target.shadowRoot).toBeNull();
    expect(host.fill).toHaveBeenCalledTimes(1);
    expect(host.fill).toHaveBeenCalledWith(marker);
    expect(host.empty).not.toHaveBeenCalled();

    unmount(app);
    expect(host.empty).toHaveBeenCalledWith(marker);
    expect(target.childNodes).toHaveLength(0);
  });

  it("empties the marker while it is still in the DOM when a v-if removes it, and fills the next one", async () => {
    const show = ref(true);
    const Toggling = defineComponent({
      props: { data: { type: Object, required: true } },
      setup() {
        return () => h("div", [show.value ? h(DropletChildren) : null]);
      },
    });
    const target = document.createElement("div");
    document.body.appendChild(target);
    const host = fakeHost();
    const connected: boolean[] = [];
    host.empty.mockImplementation((marker) => connected.push(marker.isConnected));
    const app = mount({ default: Toggling }, target, { data: {} }, clientContext(host));
    const first = target.querySelector("[data-droplet-children]");
    expect(host.fill).toHaveBeenCalledWith(first);

    show.value = false;
    await nextTick();
    expect(host.empty).toHaveBeenCalledWith(first);
    expect(connected).toEqual([true]);
    expect(target.querySelector("[data-droplet-children]")).toBeNull();

    show.value = true;
    await nextTick();
    const second = target.querySelector("[data-droplet-children]");
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
    expect(host.fill).toHaveBeenLastCalledWith(second);
    unmount(app);
  });

  it("adopts the server-rendered marker when hydrating and fills it once mounted", async () => {
    const target = document.createElement("div");
    target.innerHTML = String(await render({ default: Scoped }, { data: { greeting: "Hi" } }, serverContext()));
    document.body.appendChild(target);
    // The element took the host's container out before hydrating: an empty marker.
    const serverMarker = target.querySelector("[data-droplet-children]")!;
    const host = fakeHost();
    const h1 = target.querySelector("h1");
    const app = hydrate({ default: Scoped }, target, { data: { greeting: "Hi" } }, clientContext(host, [serverMarker]));
    expect(host.empty).not.toHaveBeenCalled();
    expect(host.fill).toHaveBeenCalledTimes(1);
    expect(host.fill).toHaveBeenCalledWith(serverMarker);
    expect(target.querySelector("h1")).toBe(h1);
    expect(target.querySelector("[data-droplet-children]")).toBe(serverMarker);
    unmount(app);
  });

  it("moves an error page's server <style> into the document head before hydrating, once", async () => {
    const ErrorComponent = defineComponent({
      styles: [".oops{color:crimson}"],
      props: { error: { type: Object, required: true } },
      setup(props: { error: { message: string } }) {
        return () => h("p", { class: "oops" }, props.error.message);
      },
    });
    const before = document.head.querySelectorAll("style[data-droplets-vue]").length;
    const out = await render({ default: ErrorComponent }, { error: { message: "no" } }, serverContext("error"));
    const page = typeof out === "string" ? out : `${out.head}${out.html}`;
    for (const _ of [1, 2]) {
      const target = document.createElement("div");
      target.innerHTML = page;
      document.body.appendChild(target);
      const p = target.querySelector("p");
      const app = hydrate({ default: ErrorComponent }, target, { error: { message: "no" } }, clientContext(fakeHost(), [], "error"));
      expect(target.querySelector("style")).toBeNull();
      expect(target.querySelector("p")).toBe(p);
      unmount(app);
    }
    // Mounting in the browser injects the same CSS: still once.
    const target = document.createElement("div");
    document.body.appendChild(target);
    unmount(mount({ default: ErrorComponent }, target, { error: { message: "no" } }, clientContext(fakeHost(), [], "error")));
    const styles = Array.from(document.head.querySelectorAll("style[data-droplets-vue]"));
    expect(styles.length - before).toBe(1);
    expect(styles.at(-1)?.textContent).toBe(".oops{color:crimson}");
  });
});
