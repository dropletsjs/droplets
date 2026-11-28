/**
 * The messages of the browser runtime: the element, enhanced forms,
 * `hooks.client.ts`, script droplets and the dev element. The dev
 * element's entries reach no production bundle: only `dev-element.ts`
 * imports them.
 *
 * @module
 */
import type { AnyMessage, ErrorPages } from "./format.ts";

export const CLIENT_MODULE_FAILED = {
  code: "client-module-failed",
  level: "error",
  what: "the droplet's browser entry (client.js) did not load; the error follows",
  fix: "check that the droplets server answers <location>/droplets/<id>/client.js and that the page may load it (CSP, CORS, network)",
} satisfies AnyMessage;

export const INLINE_PAYLOAD_UNREADABLE = {
  code: "inline-payload-unreadable",
  level: "error",
  what: ({ selector }: { selector: string }) => `failed to parse ${selector}; the error follows`,
  fix: "paste the fragment exactly as the droplets server answered it; its inline payloads are base64 JSON the host must not change",
} satisfies AnyMessage;

export const CONTEXT_ATTRIBUTE_UNREADABLE = {
  code: "context-attribute-unreadable",
  level: "error",
  what: "failed to parse data-droplet-context; the error follows",
  fix: "keep data-droplet-context as the droplets server wrote it, or write the props as JSON in data-droplet-props instead",
} satisfies AnyMessage;

export const PROPS_ATTRIBUTE_NOT_OBJECT = {
  code: "props-attribute-not-object",
  level: "error",
  what: "data-droplet-props must be a JSON object",
  fix: "write an object, e.g. data-droplet-props='{\"page\": 2}'",
} satisfies AnyMessage;

export const PROPS_ATTRIBUTE_UNREADABLE = {
  code: "props-attribute-unreadable",
  level: "error",
  what: "failed to parse data-droplet-props; the error follows",
  fix: "write valid JSON in the attribute, quoted for HTML, e.g. data-droplet-props='{\"page\": 2}'",
} satisfies AnyMessage;

export const BUILD_MISMATCH = {
  code: "build-mismatch",
  level: "error",
  what: ({ served, loaded }: { served: string; loaded: string }) => `served by build ${served}, this page runs ${loaded}`,
  fix: "reload the page, so it loads the server's current /index.js",
} satisfies AnyMessage;

export const PAYLOAD_UNDECODABLE = {
  code: "payload-undecodable",
  level: "error",
  what: ({ source, reason }: { source: string; reason: string }) => `${source} cannot be read: ${reason}`,
  fix: "serve the fragment and the answers exactly as the droplets server wrote them, to a page that loads the same build's /index.js; a host must not change the payload or its transported list",
} satisfies AnyMessage;

export const DATA_ANSWER_UNUSABLE = {
  code: "data-answer-unusable",
  level: "error",
  what: ({ answer }: { answer: string }) => `_data answered ${answer}; the droplet renders nothing`,
  fix: "check what <location>/droplets/<id>/_data answers: a proxy or handle in hooks.server.ts may answer it instead of the droplet",
} satisfies AnyMessage;

export const PROPS_REFUSED_IN_BROWSER = {
  code: "props-refused-in-browser",
  level: "error",
  what: ({ reason }: { reason: string }) => `the props schema of +droplet.ts refused the props: ${reason}`,
  fix: "pass props that match the schema in data-droplet-props or the fragment's query",
} satisfies AnyMessage;

export const DROPLET_FAILED_IN_BROWSER = {
  code: "droplet-failed-in-browser",
  level: "error",
  what: "the droplet threw in the browser while it loaded or rendered; the error follows, and its error page shows instead",
  fix: "read the error logged after this message: it comes from load in +droplet.ts or the component",
} satisfies AnyMessage;

export const HANDLE_ERROR_THREW_IN_BROWSER = {
  code: "handle-error-threw-in-browser",
  level: "error",
  what: "handleError in +droplet.ts threw; the error follows, and the droplet renders nothing",
  fix: "return { status, message } from handleError, and never throw from it",
} satisfies AnyMessage;

export const ERROR_PAGE_MOUNT_FAILED = {
  code: "error-page-mount-failed",
  level: "error",
  what: "the droplet's error page (+error.*) failed to render in the browser; the error follows",
  fix: "read the error logged after this message: +error.* gets { error } with status and message only",
} satisfies AnyMessage;

export const UNMOUNT_FAILED = {
  code: "unmount-failed",
  level: "error",
  what: "the droplet's component threw while it was unmounted; the error follows",
  fix: "read the error logged after this message: a cleanup in the component threw",
} satisfies AnyMessage;

export const FRAGMENT_ANSWER_INVALID = {
  code: "fragment-answer-invalid",
  level: "error",
  what: ({ answer }: { answer: string }) => `the fragment request answered ${answer}`,
  fix: "check what <location>/droplets/<id> answers to a POST: a proxy or handle in hooks.server.ts may answer it instead of the droplet",
} satisfies AnyMessage;

export const FRAGMENT_REFETCH_FAILED = {
  code: "fragment-refetch-failed",
  level: "error",
  what: "could not fetch the fragment again; the error follows, and the droplet stays as it was",
  fix: "read the error logged after this message: the droplets server did not answer the fragment",
} satisfies AnyMessage;

export const ACTION_ANSWER_NOT_RESULT = {
  code: "action-answer-not-result",
  level: "error",
  what: ({ action, answer }: { action: string; answer: string }) => `action ${action} answered ${answer}, not a result`,
  fix: "check what <location>/droplets/<id>?/<action> answers: a proxy or handle in hooks.server.ts may answer it instead of the action",
} satisfies AnyMessage;

export const ACTION_REQUEST_FAILED = {
  code: "action-request-failed",
  level: "error",
  what: ({ action }: { action: string }) => `action ${action} failed; the error follows`,
  fix: "read the error logged after this message: the post did not reach the droplets server (network, CORS)",
} satisfies AnyMessage;

export const ACTION_REDIRECT_UNANSWERABLE = {
  code: "action-redirect-unanswerable",
  level: "error",
  what: ({ action }: { action: string }) => `action ${action} redirected to a URL the server never answers; not followed`,
  fix: "redirect() to a page on the host, an absolute http(s) URL or a path, never to a droplets route",
} satisfies AnyMessage;

export const CLIENT_INIT_NOT_FUNCTION = {
  code: "client-init-not-function",
  level: "error",
  what: "init is not a function; starting the droplets without it",
  fix: "export init as a function from src/hooks.client.ts: export function init() { … }",
} satisfies AnyMessage;

export const CLIENT_INIT_REJECTED = {
  code: "client-init-rejected",
  level: "error",
  what: "init() returned a promise that rejected; init is not waited for; the error follows",
  fix: "read the error logged after this message, and catch what init awaits",
} satisfies AnyMessage;

export const CLIENT_INIT_THREW = {
  code: "client-init-threw",
  level: "error",
  what: "init() failed; starting the droplets anyway; the error follows",
  fix: "read the error logged after this message: init in src/hooks.client.ts threw",
} satisfies AnyMessage;

export const SCRIPT_DEFAULT_NOT_FUNCTION = {
  code: "script-default-not-function",
  level: "error",
  what: "+droplet.script.ts must export a default function (data, el)",
  fix: "export default function (data, el) { … } from +droplet.script.ts",
} satisfies AnyMessage;

export const FAKE_COMPONENT_NOT_FUNCTION = {
  code: "fake-component-not-function",
  level: "error",
  what: ({ kind }: { kind: string }) => `a .fake.js ${kind} must export a default function`,
  fix: "export default a function of the props that returns the HTML, in the conformance kit's .fake.js component",
} satisfies AnyMessage;

export const ELEMENT_DEFINED_BY_OTHER_BUILD = {
  code: "element-defined-by-other-build",
  level: "warning",
  what: ({ element, other, build }: { element: string; other: string; build: string }) =>
    `<${element}> is already defined by another build of this server (${other}); build ${build} adopts its elements, and the first build's code runs them all`,
  fix: "load one /index.js per element name, or give each server its own element",
} satisfies AnyMessage;

export const DEV_STRATEGY_PARAM_INVALID = {
  code: "dev-strategy-param-invalid",
  level: "warning",
  what: ({ asked, strategy }: { asked: string; strategy: string }) => `index.js?strategy=${asked} is no strategy; using ${strategy}`,
  fix: "use hmr, remount, reload or manual",
} satisfies AnyMessage;

export const LOOSE_CHILD_REMOVED = {
  code: "loose-child-removed",
  level: "warning",
  what: ({ element, child }: { element: string; child: string }) =>
    `<${element}> takes its children in one <div data-droplet-slot>; removed ${child}`,
  fix: "wrap the host's children in one <div data-droplet-slot> inside the element",
} satisfies AnyMessage;

export const HYDRATE_ATTRIBUTE_INVALID = {
  code: "hydrate-attribute-invalid",
  level: "warning",
  what: ({ asked }: { asked: string }) => `data-droplet-hydrate="${asked}" is no hydrate mode; using the droplet's own`,
  fix: "use true, false, visible or interactive",
} satisfies AnyMessage;

export const HYDRATE_FALSE_ON_SCRIPT_DROPLET = {
  code: "hydrate-false-on-script-droplet",
  level: "warning",
  what: 'data-droplet-hydrate="false" is ignored: a script droplet only runs in the browser',
  fix: "remove data-droplet-hydrate from the element, or write the droplet as a component to render it without JavaScript",
} satisfies AnyMessage;

export const HMR_EVENT_FAILED = {
  code: "hmr-event-failed",
  level: "error",
  what: "failed to handle hmr event; the error follows",
  fix: "read the error logged after this message, then reload the page",
} satisfies AnyMessage;

export const REMOUNT_FAILED = {
  code: "remount-failed",
  level: "error",
  what: "remount failed; the error follows",
  fix: "read the error logged after this message, then reload the page",
} satisfies AnyMessage;

export const DEV_TOOL_MISSING = {
  code: "dev-tool-missing",
  level: "warning",
  what: "injectTool: the dev tool comes with @dropletsjs/devtools, which is not in the Vite config",
  fix: "add dropletsDevtools() from @dropletsjs/devtools to the Vite plugins",
} satisfies AnyMessage;

export const DEV_TOOL_LOAD_FAILED = {
  code: "dev-tool-load-failed",
  level: "error",
  what: "could not load the dev tool; the error follows",
  fix: "read the error logged after this message; check that the dev server answers the tool's module",
} satisfies AnyMessage;

export const BROWSER_PAGES: ErrorPages = {
  "client-module-failed": {
    when: "In the browser, when the element imports a droplet's client.js to hydrate or mount it and the import fails.",
  },
  "inline-payload-unreadable": {
    when: "In the browser, when the element reads a fragment's inline payload (the context or the data script) and it is not the base64 JSON the server wrote.",
  },
  "context-attribute-unreadable": {
    when: "In the browser, when the element reads data-droplet-context and it is not the base64 JSON the server wrote. The element reads data-droplet-props next.",
  },
  "props-attribute-not-object": {
    when: "In the browser, when a host writes data-droplet-props with JSON that is not an object (an array, a string, a number).",
    see: "/integrate/client-only/",
  },
  "props-attribute-unreadable": {
    when: "In the browser, when data-droplet-props holds text that is not JSON.",
    see: "/integrate/client-only/",
  },
  "build-mismatch": {
    when: "In the browser, when the droplets server answers _data from another build than the page's /index.js, after a deploy. The page is told once; the error is never logged.",
  },
  "payload-undecodable": {
    when: "In the browser, when a droplet's inline data payload, its _data answer or an enhanced form's action answer lists a transported value (Date, Map, Set, URL, BigInt) this page cannot decode: the inline payload is skipped for _data, the others render nothing.",
    see: "/integrate/http-contract/",
  },
  "data-answer-unusable": {
    when: "In the browser, when a droplet's _data request answers neither its payload nor an error page's (500 or 504 with { error }): a 404, a redirect, a proxy's page.",
  },
  "props-refused-in-browser": {
    when: "In the browser, when a droplet mounts without server markup (ssr = false, or data-droplet-props) and the props schema of +droplet.ts refuses its props.",
  },
  "droplet-failed-in-browser": {
    when: "In the browser, when load in +droplet.ts or the component throws while the droplet hydrates, mounts or refreshes, in production as under vite dev.",
    see: "/guides/errors/",
  },
  "handle-error-threw-in-browser": {
    when: "In the browser, when handleError in +droplet.ts throws while the element turns a droplet's error into what its error page shows.",
    see: "/guides/errors/",
  },
  "error-page-mount-failed": {
    when: "In the browser, when the droplet's +error.* component throws while it hydrates or mounts.",
    see: "/guides/errors/",
  },
  "unmount-failed": {
    when: "In the browser, when the element takes a droplet's component down (removed, updated, remounted) and its renderer's unmount throws.",
  },
  "fragment-answer-invalid": {
    when: "In the browser, when the element posts for a droplet's fragment again (after an enhanced form's action) and the answer is not HTML holding that droplet.",
  },
  "fragment-refetch-failed": {
    when: "In the browser, after an enhanced form's action in a droplet that does not hydrate, when the fragment cannot be fetched again.",
    see: "/guides/actions/",
  },
  "action-answer-not-result": {
    when: "In the browser, when an enhanced form posts an action and the answer is not an action result (a proxy's page, an error answer).",
    see: "/guides/actions/",
  },
  "action-request-failed": {
    when: "In the browser, when an enhanced form's post fails before an answer arrives.",
    see: "/guides/actions/",
  },
  "action-redirect-unanswerable": {
    when: "In the browser, when an enhanced form's action answers redirect() to a URL the page cannot go to: a droplets route, or not http(s).",
    see: "/guides/actions/",
  },
  "client-init-not-function": {
    when: "In the browser, when /index.js starts and src/hooks.client.ts exports an init that is not a function.",
    see: "/guides/in-the-browser/",
  },
  "client-init-rejected": {
    when: "In the browser, when init of src/hooks.client.ts returns a promise that rejects. The droplets have started already: init is not waited for.",
    see: "/guides/in-the-browser/",
  },
  "client-init-threw": {
    when: "In the browser, when init of src/hooks.client.ts throws. The droplets start anyway.",
    see: "/guides/in-the-browser/",
  },
  "script-default-not-function": {
    when: "In the browser, when a script droplet mounts and its +droplet.script.ts has no default export that is a function.",
    see: "/renderers/script/",
  },
  "fake-component-not-function": {
    when: "In the renderer conformance kit (@dropletsjs/droplets/testing), when a .fake.js component of the fake renderer has no default function.",
  },
  "element-defined-by-other-build": {
    when: "Under vite dev, in the browser, when a page loads a second /index.js of the same element name from another build.",
  },
  "dev-strategy-param-invalid": {
    when: "Under vite dev, in the browser, when /index.js is loaded with a strategy query that names no strategy.",
    see: "/guides/development/",
  },
  "loose-child-removed": {
    when: "Under vite dev, in the browser, when the element finds children of the host outside one <div data-droplet-slot>.",
  },
  "hydrate-attribute-invalid": {
    when: "Under vite dev, in the browser, when a host writes data-droplet-hydrate with a value that is no hydrate mode.",
  },
  "hydrate-false-on-script-droplet": {
    when: 'Under vite dev, in the browser, when a host writes data-droplet-hydrate="false" on a script droplet, which always runs.',
    see: "/renderers/script/",
  },
  "hmr-event-failed": {
    when: "Under vite dev, in the browser, when applying an edit to a droplet on the page throws.",
    see: "/guides/development/",
  },
  "remount-failed": {
    when: "Under vite dev, in the browser, when the element remounts a droplet after an edit and the remount throws.",
    see: "/guides/development/",
  },
  "dev-tool-missing": {
    when: "Under vite dev, in the browser, when dev.injectTool or index.js?injectTool=true asks for the dev tool and @dropletsjs/devtools is not installed.",
    see: "/guides/development/",
  },
  "dev-tool-load-failed": {
    when: "Under vite dev, in the browser, when the dev tool's module does not load.",
    see: "/guides/development/",
  },
};
