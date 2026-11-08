// @vitest-environment node
import Handlebars from "handlebars";
import { describe, expect, it } from "vitest";
import { env, registerHelpers } from "../src/runtime.ts";
import { render } from "../src/server.ts";

const compile = (source: string) => ({
  default: env.template(new Function(`return ${Handlebars.precompile(source) as unknown as string}`)() as never),
});

const actionUrl = (name?: string) => `https://drops.test/droplets/hello${name ? `?/${name}&page=1` : "?page=1"}`;
const context = { droplet: "hello", kind: "droplet" as const, renderId: "abc123", actionUrl };

describe("render", () => {
  it("renders a droplet with { data } as the context and the children marker", () => {
    const template = compile('<h1>{{data.title}}</h1><div>{{{children}}}</div>');
    expect(render(template, { data: { title: "A & B" } }, context)).toBe('<h1>A &amp; B</h1><div><div data-app-children style="display: contents"></div></div>');
  });

  it("renders an error page with { error }", () => {
    const template = compile('<p>{{error.message}}</p>{{children}}');
    expect(render(template, { error: { message: "Sorry" } }, { ...context, kind: "error" })).toBe(
      '<p>Sorry</p><div data-app-children style="display: contents"></div>',
    );
  });

  it("exposes the render as data variables and the context as @root", () => {
    const template = compile("{{@droplet}}/{{@kind}}/{{@renderId}}/{{#with data.inner}}{{@root.data.title}}{{/with}}");
    expect(render(template, { data: { title: "T", inner: {} } }, context)).toBe("hello/droplet/abc123/T");
  });

  it("outputs action URLs with {{action}}, escaped for an attribute", () => {
    const template = compile('<form action="{{action}}"></form><form action="{{action "leave"}}"></form>');
    expect(render(template, { data: {} }, context)).toBe(
      '<form action="https://drops.test/droplets/hello?page&#x3D;1"></form>' +
        '<form action="https://drops.test/droplets/hello?/leave&amp;page&#x3D;1"></form>',
    );
    expect(() => render(compile("{{action 1}}"), { data: {} }, context)).toThrow("{{action}} takes an action name");
  });

  it("throws a clear error for a module without a template", () => {
    expect(() => render({ default: "nope" }, { data: {} }, { ...context, kind: "error" })).toThrow(
      "hello: +error.hbs did not compile to a template function",
    );
  });
});

describe("registerHelpers", () => {
  it("registers exported functions, the default object's entries, and never children or action", () => {
    const target = Handlebars.create();
    target.registerHelper("children", () => "mine");
    target.registerHelper("action", () => "ours");
    registerHelpers(target, {
      upper: (v: unknown) => String(v).toUpperCase(),
      notAHelper: 42,
      children: () => "theirs",
      action: () => "https://evil.example/",
      default: { lower: (v: unknown) => String(v).toLowerCase(), upper: () => "from default" },
    });
    expect(target.compile("{{upper 'a'}}{{lower 'B'}}{{children}}{{action}}")({})).toBe("Abmineours");
    expect(target.helpers["notAHelper"]).toBeUndefined();
  });
});
