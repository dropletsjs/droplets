/**
 * The messages of the renderer packages (`@dropletsjs/renderer-*`), on the
 * server, in the browser and in their Vite plugins.
 *
 * @module
 */
import type { AnyMessage, ErrorPages } from "./format.ts";

export const COMPONENT_NOT_RENDERABLE = {
  code: "component-not-renderable",
  level: "error",
  what: ({ kind, framework }: { kind: string; framework: string }) => `the ${kind} component is not a ${framework} component`,
  fix: ({ framework }: { kind: string; framework: string }) =>
    `default-export a ${framework} component from the file, or give it the extension of its own renderer`,
} satisfies AnyMessage;

export const HANDLEBARS_TEMPLATE_NOT_COMPILED = {
  code: "handlebars-template-not-compiled",
  level: "error",
  what: ({ kind }: { kind: string }) => `+${kind}.hbs did not compile to a template function`,
  fix: "keep the handlebars() renderer in the Vite config, so it compiles every .hbs file of the droplet",
} satisfies AnyMessage;

export const HANDLEBARS_ACTION_NAME_INVALID = {
  code: "handlebars-action-name-invalid",
  level: "error",
  what: "{{action}} takes an action name",
  fix: 'pass the name as a string, {{action "add"}}, or nothing for the default action',
} satisfies AnyMessage;

export const HANDLEBARS_ACTION_OUTSIDE_DROPLET = {
  code: "handlebars-action-outside-droplet",
  level: "error",
  what: "{{action}} runs in a droplet's template, rendered by the renderer",
  fix: "use {{action}} only in a droplet's own template or a partial it renders, not in a template compiled by hand",
} satisfies AnyMessage;

export const HANDLEBARS_PARTIALS_FOLDER_MISSING = {
  code: "handlebars-partials-folder-missing",
  level: "error",
  what: "Handlebars partials without a partials folder",
  fix: "set handlebars({ partials }) to the folder that holds the partials",
} satisfies AnyMessage;

export const HANDLEBARS_PARTIAL_STYLE = {
  code: "handlebars-partial-style",
  level: "error",
  what: "a partial has no <style>",
  fix: "put the <style> block in the droplet templates that use the partial",
} satisfies AnyMessage;

export const HANDLEBARS_STYLE_LINE_MISSING = {
  code: "handlebars-style-line-missing",
  level: "error",
  what: ({ line }: { line: number }) => `no line ${line} in the template`,
  fix: "report it with the template: the parser gave a position outside the file",
} satisfies AnyMessage;

export const HANDLEBARS_STYLE_NESTED = {
  code: "handlebars-style-nested",
  level: "error",
  what: "a <style> block goes at the top of the template, outside {{#…}} blocks",
  fix: "move the <style> block out of the {{#…}} block, to the top level of the template",
} satisfies AnyMessage;

export const HANDLEBARS_STYLE_SRC_WITH_CSS = {
  code: "handlebars-style-src-with-css",
  level: "error",
  what: ({ src }: { src: string }) => `<style src="${src}"> takes its CSS from the file`,
  fix: "leave the block empty, or drop src and keep the CSS inline",
} satisfies AnyMessage;

export const HANDLEBARS_STYLE_DYNAMIC = {
  code: "handlebars-style-dynamic",
  level: "error",
  what: "a <style> block cannot contain {{…}}: CSS is static",
  fix: "take the {{…}} out of the <style> block; set a class or a style attribute in the markup instead",
} satisfies AnyMessage;

export const HANDLEBARS_FLAGS_MISPLACED = {
  code: "handlebars-flags-misplaced",
  level: "error",
  what: "flag lines are in a comment other than the one the template starts with",
  fix: "move every flag line into the comment the template starts with, before anything else",
} satisfies AnyMessage;

export const HANDLEBARS_FLAG_LINE_INVALID = {
  code: "handlebars-flag-line-invalid",
  level: "error",
  what: ({ line }: { line: string }) => `the flags comment holds "${line}"`,
  fix: "write one `export <flag> = true|false` per line, and nothing else, in the flags comment",
} satisfies AnyMessage;

export const HANDLEBARS_FLAG_UNKNOWN = {
  code: "handlebars-flag-unknown",
  level: "error",
  what: ({ name, known }: { name: string; known: string }) => `unknown flag "${name}" (expected ${known})`,
  fix: "use ssr, hydrate or prerender, spelled as here",
} satisfies AnyMessage;

export const HANDLEBARS_FLAG_REPEATED = {
  code: "handlebars-flag-repeated",
  level: "error",
  what: ({ name }: { name: string }) => `flag "${name}" is declared twice`,
  fix: "keep one declaration of the flag",
} satisfies AnyMessage;

export const HANDLEBARS_FLAG_VALUE_INVALID = {
  code: "handlebars-flag-value-invalid",
  level: "error",
  what: ({ name, value, expected }: { name: string; value: string; expected: string }) =>
    `flag "${name}" must be ${expected}, found "${value}"`,
  fix: "write the value literally, without quotes around true or false",
} satisfies AnyMessage;

export const LIT_TAG_INVALID = {
  code: "lit-tag-invalid",
  level: "error",
  what: ({ tag, kind }: { tag: string; kind: string }) => `"${tag}" is not a valid custom element name for the Lit ${kind}`,
  fix: "rename the droplet folder (lowercase letters, digits, hyphens) or set lit({ prefix })",
} satisfies AnyMessage;

export const LIT_COMPONENT_NOT_ELEMENT = {
  code: "lit-component-not-element",
  level: "error",
  what: ({ kind }: { kind: string }) => `the ${kind} component must default-export a LitElement class`,
  fix: "write `export default class Hello extends DropletElement { … }`; the renderer defines the element",
} satisfies AnyMessage;

export const LIT_PREFIX_INVALID = {
  code: "lit-prefix-invalid",
  level: "error",
  what: ({ prefix }: { prefix: string }) => `lit({ prefix }): "${prefix}" must start with a lowercase letter`,
  fix: "use lowercase letters, digits and hyphens, starting with a letter",
} satisfies AnyMessage;

export const LIT_ENHANCE_NOT_ON_FORM = {
  code: "lit-enhance-not-on-form",
  level: "error",
  what: ({ tag }: { tag: string }) => `enhance() goes on a <form> element, not ${tag}`,
  fix: "write it as an element directive on the form: <form ${enhance()}>",
} satisfies AnyMessage;

export const LIT_TAG_TAKEN = {
  code: "lit-tag-taken",
  level: "warning",
  what: ({ tag }: { tag: string }) =>
    `<${tag}> is defined by another class on this page (an edited module, or another droplets server with the same element name); rendering it afresh`,
  fix: "give each droplets server on the page its own lit({ prefix }); after an edit, reload the page",
} satisfies AnyMessage;

export const PREFRESH_UPDATE_FAILED = {
  code: "prefresh-update-failed",
  level: "error",
  what: "Prefresh could not apply the update; the error follows",
  fix: "reload the page; if it keeps failing, read the error for the component that broke",
} satisfies AnyMessage;

export const PREFRESH_RUNTIME_MISSING = {
  code: "prefresh-runtime-missing",
  level: "warning",
  what: "Prefresh's runtime (@prefresh/core, @prefresh/utils) did not resolve: Preact droplets remount on an edit",
  fix: "install the renderer's dependencies again (they come with @dropletsjs/renderer-preact)",
} satisfies AnyMessage;

export const REACT_RECOVERABLE_ERROR = {
  code: "react-recoverable-error",
  level: "error",
  what: ({ kind }: { kind: string }) => `React recovered from an error in the ${kind} component; the error and the component stack follow`,
  fix: "read the error: a hydration mismatch means the server and the browser rendered different markup",
} satisfies AnyMessage;

export const REACT_UNCAUGHT_ERROR = {
  code: "react-uncaught-error",
  level: "error",
  what: ({ kind }: { kind: string }) => `uncaught error in the ${kind} component; the error and the component stack follow`,
  fix: "fix the component, or add +error.tsx so the droplet shows its error page",
} satisfies AnyMessage;

export const REACT_CAUGHT_ERROR = {
  code: "react-caught-error",
  level: "error",
  what: ({ kind }: { kind: string }) =>
    `an error boundary in the ${kind} component caught an error; the error and the component stack follow`,
  fix: "read the error and fix the component below that boundary",
} satisfies AnyMessage;

export const RENDERERS_PAGES: ErrorPages = {
  "component-not-renderable": {
    when: "On the server or in the browser, when a renderer gets a droplet's component (or error page) whose default export is not a component of its framework.",
    see: "/renderers/",
  },
  "handlebars-template-not-compiled": {
    when: "On the server or in the browser, when a droplet's .hbs module has no compiled template as its default export.",
    see: "/renderers/handlebars/",
  },
  "handlebars-action-name-invalid": {
    when: "While a Handlebars template renders, when {{action}} gets something other than a string.",
    see: "/renderers/handlebars/",
  },
  "handlebars-action-outside-droplet": {
    when: "While a Handlebars template renders without the renderer's data frame, so no action URL is known.",
    see: "/renderers/handlebars/",
  },
  "handlebars-partials-folder-missing": {
    when: "vite dev or vite build, when the Handlebars renderer is given partials without a partials folder.",
    see: "/renderers/handlebars/",
  },
  "handlebars-partial-style": {
    when: "vite dev or vite build, when a Handlebars partial holds a <style> block.",
    see: "/renderers/handlebars/",
  },
  "handlebars-style-line-missing": {
    when: "vite dev or vite build, when the template parser reports a position past the end of the file.",
  },
  "handlebars-style-nested": {
    when: "vite dev or vite build, when a <style> block sits inside a {{#…}} block of a Handlebars template.",
    see: "/renderers/handlebars/",
  },
  "handlebars-style-src-with-css": {
    when: "vite dev or vite build, when a <style src> block of a Handlebars template also holds CSS.",
    see: "/renderers/handlebars/",
  },
  "handlebars-style-dynamic": {
    when: "vite dev or vite build, when a <style> block of a Handlebars template holds {{…}}.",
    see: "/renderers/handlebars/",
  },
  "handlebars-flags-misplaced": {
    when: "vite dev or vite build, when a Handlebars template has flag lines in any comment but its first one. The build fails: the flags comment is the framework's own syntax inside a string.",
    see: "/renderers/handlebars/",
  },
  "handlebars-flag-line-invalid": {
    when: "vite dev or vite build, when the flags comment of a Handlebars template holds a line that is not a flag declaration.",
    see: "/renderers/handlebars/",
  },
  "handlebars-flag-unknown": {
    when: "vite dev or vite build, when the flags comment of a Handlebars template declares a flag the framework does not know.",
    see: "/renderers/handlebars/",
  },
  "handlebars-flag-repeated": {
    when: "vite dev or vite build, when the flags comment of a Handlebars template declares one flag twice.",
    see: "/renderers/handlebars/",
  },
  "handlebars-flag-value-invalid": {
    when: "vite dev or vite build, when a flag in the flags comment of a Handlebars template has a value it does not take.",
    see: "/renderers/handlebars/",
  },
  "lit-tag-invalid": {
    when: "On the server or in the browser, when the Lit renderer builds a droplet's tag name from the prefix and the folder and gets an invalid custom element name.",
    see: "/renderers/lit/",
  },
  "lit-component-not-element": {
    when: "On the server or in the browser, when a Lit droplet's module does not default-export a LitElement class.",
    see: "/renderers/lit/",
  },
  "lit-prefix-invalid": {
    when: "When the Vite config calls lit() with a prefix that is no valid start of a custom element name.",
    see: "/renderers/lit/",
  },
  "lit-enhance-not-on-form": {
    when: "In the browser, when the Lit enhance() directive is bound anywhere but on a <form> element.",
    see: "/renderers/lit/",
  },
  "lit-tag-taken": {
    when: "In the browser, when a Lit droplet hydrates and its tag is already defined by another class on the page; the droplet renders afresh.",
    see: "/renderers/lit/",
  },
  "prefresh-update-failed": {
    when: "In the browser under vite dev, when Prefresh fails to apply an edit to a Preact component.",
    see: "/guides/development/#hot-updates",
  },
  "prefresh-runtime-missing": {
    when: "vite dev, when the Preact renderer cannot resolve Prefresh's runtime; Preact droplets then remount on an edit.",
    see: "/guides/development/#hot-updates",
  },
  "react-recoverable-error": {
    when: "In the browser, when React reports an error it recovered from in a droplet, a hydration mismatch most often.",
    see: "/renderers/react/",
  },
  "react-uncaught-error": {
    when: "In the browser, when a React droplet throws while rendering and nothing catches it.",
    see: "/renderers/react/",
  },
  "react-caught-error": {
    when: "In the browser, when an error boundary of the component's own (not the droplet's) catches an error.",
    see: "/renderers/react/",
  },
};
