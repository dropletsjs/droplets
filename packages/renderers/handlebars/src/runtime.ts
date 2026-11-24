/**
 * The Handlebars environment every droplet template runs in, on the server
 * and in the browser. One `Handlebars.create()` of `handlebars/runtime`,
 * never the global `Handlebars`: helpers and partials registered here stay
 * inside the droplets runtime and never leak into other Handlebars users on
 * the page or in the process.
 *
 * Compiled `.hbs` modules import `env` from here and call `env.template()`
 * on their precompiled spec; the generated setup module registers the
 * project's partials and helpers into it once per bundle (modules are
 * singletons), so nothing is duplicated per droplet.
 */
import Handlebars from "handlebars/runtime";
import {
  dropletsError,
  HANDLEBARS_ACTION_NAME_INVALID,
  HANDLEBARS_ACTION_OUTSIDE_DROPLET,
  HANDLEBARS_TEMPLATE_NOT_COMPILED,
} from "@dropletsjs/droplets/errors";

export type HandlebarsEnvironment = typeof Handlebars;

/** A compiled template: `(context, options) => string`. */
export type Template = Handlebars.TemplateDelegate;

/** The droplets Handlebars environment. */
export const env: HandlebarsEnvironment = Handlebars.create();

/** What `{{{children}}}` outputs: the marker the element fills with the host's container. */
export const MARKER = '<div data-droplet-children style="display: contents"></div>';

// `{{{children}}}` (or `{{children}}`) outputs the children marker, as the
// contract wants it.
env.registerHelper("children", () => new env.SafeString(MARKER));

/**
 * `{{action}}` / `{{action "add"}}`: where a form posts for the droplet's
 * action (`default` without a name), from the render's `actionUrl` in the
 * data frame: the same URL on the server and in the browser. Escaped as
 * any `{{…}}` value, for an `action="…"`.
 */
env.registerHelper("action", function (this: unknown, ...args: unknown[]) {
  const options = args.pop() as Handlebars.HelperOptions;
  const name = args[0];
  if (name !== undefined && typeof name !== "string") throw dropletsError({ message: HANDLEBARS_ACTION_NAME_INVALID });
  const actionUrl = (options.data as { actionUrl?: unknown } | undefined)?.actionUrl;
  if (typeof actionUrl !== "function") throw dropletsError({ message: HANDLEBARS_ACTION_OUTSIDE_DROPLET });
  return (actionUrl as (name?: string) => string)(name);
});

/** The helpers the renderer owns: a project's own by these names are left out. */
const OWN_HELPERS = new Set(["children", "action"]);

type TemplateOfInput = { module: { default?: unknown }; where: { droplet: string; kind: string } };

/** The template of a compiled module, or a clear error naming the file. */
export function templateOf({ module, where }: TemplateOfInput): Template {
  const template = module.default;
  if (typeof template !== "function") {
    throw dropletsError({ message: HANDLEBARS_TEMPLATE_NOT_COMPILED, params: { kind: where.kind }, droplet: where.droplet });
  }
  return template as Template;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

type RegisterHelpersInput = { target: HandlebarsEnvironment; module: Record<string, unknown> };

/**
 * Registers the helpers a user module exports: every named export that is a
 * function, plus the entries of a `default` export when it is an object of
 * functions (named exports win). `children` and `action` are the
 * renderer's and are left alone.
 */
export function registerHelpers({ target, module }: RegisterHelpersInput): void {
  const fromDefault = isObject(module["default"]) ? module["default"] : {};
  const entries: Record<string, unknown> = { ...fromDefault, ...module };
  for (const [name, fn] of Object.entries(entries)) {
    if (name === "default" || OWN_HELPERS.has(name) || typeof fn !== "function") continue;
    target.registerHelper(name, fn as Handlebars.HelperDelegate);
  }
}
