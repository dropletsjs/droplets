// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
import { DropletChildren } from "../src/children.ts";
import { hydrate, mount, unmount } from "../src/client.ts";
import { render } from "../src/server.ts";
import { clientContext, fakeHost, Scoped, serverContext } from "./doubles.ts";

describe("DropletChildren in the browser", () => {
  it("renders the marker in light DOM, fills it when mounted and empties it before unmount", () => {
    const target = document.createElement("div");
    document.body.appendChild(target);
    const host = fakeHost();
    const app = mount({ default: Scoped }, target, { data: { greeting: "Hi" } }, clientContext({ host }));
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
    const app = mount({ default: Toggling }, target, { data: {} }, clientContext({ host }));
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
    const serverMarker = target.querySelector("[data-droplet-children]") ?? expect.unreachable("the children marker");
    const host = fakeHost();
    const h1 = target.querySelector("h1");
    const app = hydrate({ default: Scoped }, target, { data: { greeting: "Hi" } }, clientContext({ host, markers: [serverMarker] }));
    expect(host.empty).not.toHaveBeenCalled();
    expect(host.fill).toHaveBeenCalledTimes(1);
    expect(host.fill).toHaveBeenCalledWith(serverMarker);
    expect(target.querySelector("h1")).toBe(h1);
    expect(target.querySelector("[data-droplet-children]")).toBe(serverMarker);
    unmount(app);
  });
});
