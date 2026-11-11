// @vitest-environment node
import Handlebars from "handlebars";
import { describe, expect, it } from "vitest";
import { env } from "../src/runtime.ts";
import { render } from "../src/server.ts";

type CompileInput = { source: string };

/** A template as the plugin would ship it: precompiled, on the renderer's environment. */
function compile({ source }: CompileInput): { default: unknown } {
  return { default: env.template(new Function(`return ${String(Handlebars.precompile(source))}`)() as never) };
}

const actionUrl = (name?: string) => `https://drops.test/droplets/hello${name ? `?/${name}&page=1` : "?page=1"}`;
const context = { droplet: "hello", kind: "droplet" as const, renderId: "abc123", actionUrl };

describe("render", () => {
  it("renders a droplet with { data } as the context and the children marker", () => {
    const template = compile({ source: "<h1>{{data.title}}</h1><div>{{{children}}}</div>" });
    expect(render(template, { data: { title: "A & B" } }, context)).toBe(
      '<h1>A &amp; B</h1><div><div data-droplet-children style="display: contents"></div></div>',
    );
  });

  it("renders an error page with { error }", () => {
    const template = compile({ source: "<p>{{error.message}}</p>{{children}}" });
    expect(render(template, { error: { message: "Sorry" } }, { ...context, kind: "error" })).toBe(
      '<p>Sorry</p><div data-droplet-children style="display: contents"></div>',
    );
  });

  it("exposes the render as data variables and the context as @root", () => {
    const template = compile({ source: "{{@droplet}}/{{@kind}}/{{@renderId}}/{{#with data.inner}}{{@root.data.title}}{{/with}}" });
    expect(render(template, { data: { title: "T", inner: {} } }, context)).toBe("hello/droplet/abc123/T");
  });

  it("outputs action URLs with {{action}}, escaped for an attribute", () => {
    const template = compile({ source: '<form action="{{action}}"></form><form action="{{action "leave"}}"></form>' });
    expect(render(template, { data: {} }, context)).toBe(
      '<form action="https://drops.test/droplets/hello?page&#x3D;1"></form>' +
        '<form action="https://drops.test/droplets/hello?/leave&amp;page&#x3D;1"></form>',
    );
    expect(() => render(compile({ source: "{{action 1}}" }), { data: {} }, context)).toThrow("{{action}} takes an action name");
  });

  it("throws a clear error for a module without a template", () => {
    expect(() => render({ default: "nope" }, { data: {} }, { ...context, kind: "error" })).toThrow(
      "hello: +error.hbs did not compile to a template function",
    );
  });
});
