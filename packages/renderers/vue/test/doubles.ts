import type { ClientRenderContext, DropletChildrenHost, ServerRenderContext } from "@dropletsjs/droplets";
import { type Mock, vi } from "vitest";
import { defineComponent, h } from "vue";
import { DropletChildren } from "../src/children.ts";

type ServerContextInput = { kind?: ServerRenderContext["kind"] };

type ClientContextInput = { host: DropletChildrenHost; markers?: Element[]; kind?: ClientRenderContext["kind"] };

type FakeHost = { fill: Mock<DropletChildrenHost["fill"]>; empty: Mock<DropletChildrenHost["empty"]> };

export function serverContext({ kind = "droplet" }: ServerContextInput = {}): ServerRenderContext {
  return { droplet: "hello", kind, renderId: "r1", actionUrl: () => "/droplets/hello" };
}

export function clientContext({ host, markers = [], kind = "droplet" }: ClientContextInput): ClientRenderContext {
  return {
    droplet: "hello",
    kind,
    children: host,
    renderId: "r1",
    markers: () => markers,
    actionUrl: () => "/droplets/hello",
  };
}

export function fakeHost(): FakeHost {
  return { fill: vi.fn<DropletChildrenHost["fill"]>(), empty: vi.fn<DropletChildrenHost["empty"]>() };
}

/** A component like a compiled `+droplet.vue` with a scoped style. */
export const Scoped = defineComponent({
  __scopeId: "data-v-test",
  props: { data: { type: Object, required: true } },
  setup(props: { data: { greeting: string } }) {
    return () => h("section", [h("h1", props.data.greeting), h("div", { class: "kids" }, [h(DropletChildren)])]);
  },
});

/** A compiled `+error.vue` in custom-element mode: its CSS inlined as `styles`. */
export const ErrorPage = defineComponent({
  styles: [".oops{color:crimson}"],
  props: { error: { type: Object, required: true } },
  setup(props: { error: { message: string } }) {
    return () => h("p", { class: "oops" }, props.error.message);
  },
});
