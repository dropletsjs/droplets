---
name: "Code style"
description: "TypeScript rules for the code in packages/* and their tests: language rules, errors, async, formatting (Biome), folders by concern and where the code runs, naming, comments, less is more, keep it simple, the one-object-parameter function, object mapping and casting."
---

# Code style

Scope: TypeScript in `packages/*` and their tests only. Not `examples/*`, not
`apps/*`, not `.svelte`, `.vue` or `.hbs` files.

The hard rules (dev code, server files, endpoints, public API, comments) are
in `AGENTS.md`; this guide does not repeat them.

## Language rules

Create a variable with `const`. Use `let` only when the code assigns the
variable again.

Compare with `===` and `!==`.

Use `PascalCase` for a `class` and a `type`. Use `camelCase` for a variable, a
function and a method. Use `UPPER_SNAKE_CASE` only for a module-level value
that never changes: `DEFAULTS`, `VARY_HEADERS`, `VIRTUAL_DROPLETS`.

Use `type` for every shape: an object, a union, an intersection, a function.
Write `interface` only where the public API lets the user merge into it
(`Locals`, `Platform`, `Register`, an augmentation of Vite's
`CustomEventMap`), with the reason in one line above it: `type` cannot merge.

Write functions and plain data, never a `class`, with three exceptions, each
named in a one-line comment above the class:

- the platform or an engine requires one: `HTMLElement` for the custom
  element, React's `Component` for an error boundary, Lit's
  `AsyncDirective`, Handlebars' `Visitor`;
- an error you throw that extends `Error`;
- a value `error()`, `redirect()` or `fail()` throws or returns, recognised
  by brand (see Errors).

A named function is a `function` declaration. An arrow function is a
callback.

Give a value with a shape you do not know yet the type `unknown`. Narrow it
before you use it. Never use `any`.

Give an exported function an explicit return type.

Use `readonly` for data that does not change once it exists, and
`readonly string[]` for an input the function only reads.

Use `T[]` when the element type is simple, that is when it holds only
letters, numbers and `.`: `string[]`, `DropletEntry[]`. Use `Array<T>` for
any other element type: `Array<[ApiRoute["segments"], ApiModule]>`.

Use `for...of`, not an indexed `for` loop, unless the code needs the index.

Use `?.` and `??` for a value that may be missing.

Narrow a value that may be `null` or `undefined` with a real check before
you use it. Do not use the `!` operator. Under `noUncheckedIndexedAccess`
that means naming the element:

```ts
// Wrong
if (candidates.length === 1) return candidates[0]!;

// Right
const [only] = candidates;
if (only !== undefined && candidates.length === 1) return only;
```

Use a named export for every value. A default export only where the consumer
fixes it: the adapter entry a runtime imports (`export default { fetch }`),
a module template the plugin generates, the `types/*` twin of a `$droplets/*`
module, a config file a tool loads. Import only the names a file uses.

Import a type with `import type` (`verbatimModuleSyntax` enforces it).

Prefer a union of string literals for a fixed set of values, with `as const`
on the list when the code needs it at runtime. Never `enum`. End a `switch`
over a union with a `never` check, so a new member fails to compile instead
of falling through.

```ts
export const DEV_STRATEGIES = ["hmr", "remount", "reload", "manual"] as const;
export type DevStrategy = (typeof DEV_STRATEGIES)[number];

type DescribeStrategyInput = { strategy: DevStrategy };

function describeStrategy({ strategy }: DescribeStrategyInput): string {
  switch (strategy) {
    case "hmr":
      return "the framework's HMR updates the component in place";
    case "remount":
      return "the droplet loads again by its flags";
    case "reload":
      return "the page reloads";
    case "manual":
      return "nothing; a word in the console";
    default: {
      const unreachable: never = strategy;
      return unreachable;
    }
  }
}
```

## Browser hot paths

In the browser runtime, the element's per-event paths (connect, click
replay, a fragment swap) do the least work they can: a registry is a `Set`
or `Map` built once at module level, a cheap check runs before a regex
(`if (!text.includes("DROPLET_")) return text;`), and a short-lived pair may
be an `as const` tuple.

## Errors

Throw an `Error`, or a class that extends `Error`. Never throw a plain
string or an object. The one other kind of thrown value is what `error()`,
`redirect()` and `fail()` produce: `HttpError`, `Redirect` and
`ActionFailure` do not extend `Error`, on purpose (no stack, the shape
SvelteKit users know). Recognise any thrown value by its predicate
(`isHttpError`, `isUnhandled`), never by `instanceof` across bundles: the
SSR bundle and the framework may hold two copies of a class.

Write a class per failure a caller branches on, named `<What>Error`, with
the facts of the failure as fields.

```ts
type PropsErrorInput = { issues: ReadonlyArray<StandardIssue> };

/** Thrown when props do not match the droplet's schema. Answered as a 400. */
export class PropsError extends Error {
  readonly status = 400;
  readonly issues: ReadonlyArray<StandardIssue>;

  constructor({ issues }: PropsErrorInput) {
    super(formatIssues({ issues }));
    this.name = "PropsError";
    this.issues = issues;
  }
}
```

A mistake in a config or a call nobody branches on is a plain
`new Error("droplets: <what is wrong>, got <value>; <what to write>")`: the
message is the fix.

Catch only where you can do something about the failure: retry, translate
it for the caller, answer a status, or fall back to a value. A fallback is
acting, when it is the value the caller should get (`return host`, `return
null`, `continue`); say why in one line when it is not obvious. Never catch
and swallow, never catch only to rethrow the same error or one with less
information.

```ts
try {
  return new URL(`${request.pathname}${request.search}`, origin);
} catch {
  // A location a header named that no URL takes: the request's own URL stands.
  return request;
}
```

## Async

Every promise is awaited or returned. The one exception is a promise that
is detached by design (`main()`, an HMR notification): it ends in
`.then(ok, fail)` or `.catch`, never bare.

Run independent calls with `Promise.all`, not with `await` one after another
in a loop. Keep `await` in the loop only when each step depends on the one
before (writing files with `wx`, prerendering in order).

Mark a function `async` only when it awaits. A function that returns a
promise it does not await is a plain function that returns a promise.

## Formatting

Biome is the linter and the formatter: what it decides about the layout of
the code, this guide does not state, and a review never comments on it.
(Biome is not set up yet; a separate step adds it.)

## Folders

A package is laid out by concern, and a concern is named for what it is and
where it runs: `runtime/` and `core/` (Node-free), `vite/` (Node, the
build), `server/` and `*.server.ts` (never a client bundle), `dev-*.ts`
(never production). Never one flat `src/`, never `utils/`, `helpers/` or
`lib/`. What goes in `packages/shared` and what stays in its own folder:
`AGENTS.md`, "Where things go".

### The shape of `packages/droplets`

```
packages/droplets/
  package.json          exports: fixed paths into dist/
  tsdown.config.ts      entry: every file something finds by path; graphCheck lists
  src/
    index.ts            the public surface, one boundary
    vite.ts  env.ts  postcss.ts  cli.ts  renderer.ts  adapters.ts   the other entries
    core/               config, discovery, env, logger, paths: Node-free, build and runtime
    runtime/            what runs per request or per element; Node-free
      app.ts            the Hono app and its routes
      host.ts           event.host and the droplet location
      entry-client.ts   the custom element (an entry: found by path)
      entry-server.ts   the SSR entry
      form-token.server.ts   *.server.ts: never a client bundle
      dev-element.ts    dev-*.ts: imported under import.meta.env.DEV only
    server/             the production server's pieces; never a client bundle
    vite/               the plugin: hooks, build, dev, virtual modules, css
    css/  script/  add/ one concern each (scoping, script droplets, djs add)
    testing/            @dropletsjs/droplets/testing: conformance, the fake renderer
    types/              the twins of the $droplets/* virtual modules, one file per module
  test/
    setup.ts  stubs/  fixtures/
    runtime/host.test.ts      mirrors src/runtime/host.ts
    core/  vite/  add/
    integration/              a real Vite in process
```

A renderer package: `index.ts` (the factory the user calls; Node, resolves
`dist/` paths), `server.ts` (`RendererServerModule`), `client.ts`
(`RendererClientModule`), `client-dev.ts`, `client-setup.ts`, `form.ts`,
`children.ts`, and what those need (`tree.ts`, `live-props.ts`). An adapter:
`index.ts` (the factory), `entry.ts` (what `vite build` bundles), `app.ts`,
`assets.ts`, `static.ts`, `fs.ts`. Those names are the contract: core finds
them by path.

### One owner for each type

A type has one owner: the module that produces the value. `renderer.ts` owns
the renderer contract, `core/config.ts` the config, `runtime/server.ts` the
events. Another module does one of two things, never a third:

1. Declares a narrower view with only the fields it reads:
   `Pick<DropletEntry, "ssr" | "hydrate" | "prerender">`.
2. Imports the owner's type.

Never copy a type, and never rebuild one with `Parameters<typeof fn>` or
`ReturnType<typeof fn>` when we own `fn`: export the type. Those helpers are
for a dependency that does not export the type
(`NonNullable<Parameters<typeof cors>[0]>`,
`ReturnType<typeof setTimeout>` where Node and the browser disagree).

### The folder shape

- `index.ts` exists only at a boundary: a package's public entry. Never an
  `index.ts` inside `src/` to shorten an import path.
- Inside a package, import the file itself by relative path with its
  extension: `./host.ts`, `../core/logger.ts`. `$droplets/*` are virtual
  modules for user code, which package code never imports (the `types/`
  twins and test aliases excepted).
- A concern with one file sits in the folder it belongs to; with two or
  more it gets a folder, in the singular, kebab-case: `fake-renderer/`.
- A file whose name something finds by path keeps that name: a tsdown
  entry, a renderer's `server.ts`/`client.ts`, an adapter's `entry.ts`.
- Keep an implementation apart from the glue that ties it to Hono, Vite or
  the DOM. The implementation takes everything as input and knows no
  framework: `resolveLocation({ c, origin, trusted })` reads nothing the
  middleware did not hand it, `moveInto({ parent, nodes })` knows no
  element. The glue (a Hono handler, a Vite hook, an element method) reads
  the context, calls the implementation and answers. Tests target the
  implementation.

### Test files

- A test lives in the package's `test/`, mirroring `src/` in path and name:
  `src/runtime/host.ts`, `test/runtime/host.test.ts`. Its kind (unit,
  integration) shows in what it does and where it is, never in its file
  name.
- One test file tests one source file. A test that covers several source
  files is split, each part named for its file.
- `test/integration/` holds tests that run a real Vite in process;
  `test/fixtures/` the projects they build; `test/stubs/` the stand-ins for
  virtual modules.
- `.spec.ts` only in `tests/*` at the repo root: a browser, Docker, a packed
  tarball, across packages.
- A renderer's own tests cover only what `rendererConformance()` does not.

## Naming

Name a file for its concern, lowercase kebab-case: `form-token.server.ts`,
`load-headers.ts`, `client-init.ts`. A file with one export takes that
export's name in kebab-case. A name something finds by path keeps its shape
(see Folders).

Name a variable for what it holds, never for its type.

Prefix a new `boolean` with `is`, `has` or `may`. A public flag keeps its
name: `ssr`, `hydrate`, `prerender` are the component contract, `cors`,
`plugin`, `tailwind` the config.

Name an array, a `Set` or a `Map` with a plural noun.

Name a function, and the variable that holds its result, for what it
returns: singular for one, plural for many. The verbs in use, so a reader
knows the shape before the body:

- `read…`: synchronous, from a header, a file text or an attribute.
- `load…`: asynchronous, from the build or disk.
- `find…`, `match…`: may return `null`.
- `resolve…`: fills in defaults and validates.
- `discover…`: scans a folder.
- `create…`: a factory that holds state.
- `is…`, `may…`: a predicate.
- `…Of`: derives one thing from one input (`contractOf`, `platformOf`);
  `to…` when it changes a representation.
- `with…`: a copy with something added (`withPrefix`, `withVary`).
- `get…`: only for a per-request thunk in an options object (`getHandle`).

Use a one-letter name only inside a short callback passed to `map`,
`filter`, `some` or a similar method, standing for the singular of the list.

## Comments

Show, don't tell: the code says what it does, and a comment never repeats
it (`AGENTS.md` rule 4).

- No comment that restates a name, a type, a signature, or what the next
  lines do. `droplet: string` needs no `/** The droplet id. */`.
- No issue numbers. A link to a CVE or a browser bug that explains a
  workaround stays.
- Keep a comment only for what the code cannot show: a workaround with its
  link, a limit imposed from outside (a browser, a runtime, a framework), an
  `ASSUMPTION` with what replaces it, a security reason (why a header is
  read last, why a token is checked before it is parsed).
- Public API gets JSDoc: everything a `dist/*.d.ts` exposes (the entries'
  exports, the renderer and adapter contracts, the config, the events). It
  is the hover a user reads. It says what the thing is for and the facts the
  type cannot carry: the default, the unit, when it is absent, what it
  throws, what it is relative to. An internal function gets a JSDoc only
  when it adds such a fact.

```ts
// `moveBefore` throws when the nodes and the parent are not both connected,
// and older browsers lack it: re-insert, which disconnects and reconnects.
```

## Less is more

Every line, file, function, type and option is something to read, test,
document and change later. Add only what the change needs today. New public
API: `AGENTS.md` rule 5.

- One route per thing (the fragment, `_data`, `client.js`, `style.css`), one
  option per behaviour, shared by every host, renderer and adapter. Never
  one per host or per framework.
- Shape the code for what the contract already names, build only what the
  change needs. When the contract names a second case (a `hydrate` mode, a
  second location header), leave the place in the types: a union member, an
  optional field. Never a function that throws "not implemented".
- Check what is already there before you write anything: missing, add it;
  incomplete, extend it with one optional input; diverging by most of its
  body, move the shared part into one function and split the rest.
- A change that removes code to reach the same behaviour is better than
  one that adds it.

## Keep it simple (KISS)

Write the most direct code that does the job. Each extra name between the
caller and the thing it needs is one more hop to read, type and test.

- Pass the value the consumer reads. A thunk only for what is per request
  or lazy: in `DropletsAppOptions`, `getHandle`, `publicEnv` and
  `loadEntryClient` are thunks because their value changes per request or
  costs a read; `element` and `buildHash` are values.
- Pass a function as itself. Never wrap one function in an object when the
  consumer uses only that function.
- No proxy functions. A function whose whole body calls another function
  with the same input adds nothing: call the original.
- No wrapper around a single value or a single call. Add a layer only when
  it holds a rule of its own (a lazy cache, a once-per-process guard).
- A function that returns more than one thing returns a named object, not a
  tuple. A tuple fits an argv shape for `spawn` (`[string, ...string[]]`),
  a `[name, value]` pair a `Map` or `Object.entries` iterates, and a
  short-lived `as const` pair in a hot path.
- Destructure a library's tuple as the library gives it; never wrap a
  library function only to turn its tuple into an object.
- The element's fields are its state; a value the dev tool shows comes from
  them, never from a mutable holder read through a getter.
- Take a type from its owner by name (see One owner for each type).
- The test: delete the layer and inline it. If the code says the same thing
  with fewer names, the layer was noise; leave it deleted.

```ts
// Wrong: a getter for a value known when the app is created
createDropletsApp({ element: () => config.element, buildHash: () => hash });

// Right: the value; a thunk only for what is per request
createDropletsApp({ element: config.element, buildHash: hash, getHandle: () => hooks().handle });
```

## Functions

A function we define and call ourselves takes one object parameter, never
several separate parameters, even when it needs only one value:
`fn({ valueA, valueB, valueC })`. Why: a key can be added, made optional or
made required without touching the callers that do not use it, and a call
reads its intent by name, `installCommand({ pm, specs, isDev: true })`, not
by position, `installCommand(pm, specs, true)`.

Destructure the object parameter in the parameter list, not inside the body.

Name the parameter's type: `<FunctionName>Input` next to the function, or
`<Thing>Options` for a factory (`DropletsAppOptions`,
`ReactRendererOptions`). Never write an object type inline in a parameter
list.

When the function passes the whole object on to another function with no
change, keep the parameter as one named value, and destructure inside the
body only the field it reads.

```ts
type ResolveLocationInput = {
  c: Context;
  origin: readonly string[];
  trusted: readonly string[];
};

function resolveLocation({ c, origin, trusted }: ResolveLocationInput): string {
  /* … */
}

// One value is still an object
type PlatformOfInput = { c: Context };

function platformOf({ c }: PlatformOfInput): RequestEvent["platform"] {
  /* … */
}

// Pass-through: the options go on whole, the body reads one field
export function createDropletsApp(options: DropletsAppOptions): Hono<AppEnv> {
  const dropletMiddleware = createDropletMiddleware(options);
  const { element = "djs-droplet" } = options;
  /* … */
}
```

A signature someone else fixes, or one we publish, keeps its shape exactly,
and we never write a wrapper whose only job is to turn it into an object
parameter or back:

- Hono handlers and middleware, `(c, next)`;
- Vite and rolldown hooks;
- DOM and Node callbacks, `Array`, `Map` and `Set` callbacks;
- our public API: the renderer contract (`render(module, props, context)`,
  `mount(module, target, props, context)`), `error()`, `redirect()`,
  `fail()`, the adapter factories, and anything a package's public entry
  exports.

A function that compares times takes `now` in its object parameter, with a
`Date.now()` default, and never reads the clock elsewhere in its body:
`readFormResult({ secret, scope, value, now = Date.now() })`. A test passes
any time. An entry point (a request handler, the element's event listener)
reads the clock once and passes it down, or stores it (`QueuedClick.time`).

Never change a parameter or anything it points to; return a new value. Type
an input array or object `readonly` when the function only reads it. The
exceptions are the contexts whose purpose is to be written, named as such:
Hono's `c` (`c.header`, `c.set`), the plugin's `state`, a `Headers`, an
accumulator `Set` or `Map` named `found` or `seen`, and the element itself.

## Object mapping and casting

To rename the fields of an object, destructure the source with a renamed
field and build the new object from the renamed names. Pass the new object
straight to a function that reads it once; name it only when the code uses
it again.

```ts
const { host: forwardedHost, proto } = parseForwarded({ header: forwarded });
const origin = forwardedOrigin({ proto: proto ?? protocol, host: forwardedHost });
```

Write a separate mapper only for a large source shape. Name it `<x>Of` when
it derives one thing from one input, `to<X>` when it changes a
representation. Its input type is the narrowest view that has the fields it
reads.

```ts
type ContractOfInput = Pick<DropletEntry, "ssr" | "hydrate" | "prerender">;

function contractOf({ ssr, hydrate, prerender }: ContractOfInput): RenderContract {
  return { ssr, hydrate, prerender };
}
```

Use `as` only for a value TypeScript cannot type any other way:

- an `unknown` the contract hands back that we produced:
  `(instance as ReactInstance).root.unmount()`;
- a Hono variable the app typed loosely: `c.get("location") as string | undefined`;
- a `JSON.parse` result, after a shape check.

Never cast client input: narrow it (`isObject(body) ? body : undefined`,
never `body as Record<string, unknown>`). Never cast to silence a mismatch
between two of our own types: fix the type. `as unknown as` only in a test,
or around the one `Proxy` that stands in for a `URL`.
