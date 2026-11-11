/**
 * `@dropletsjs/droplets/env`: declaring environment variables, SvelteKit 3
 * style. Declare them once in `src/env.ts`:
 *
 * ```ts
 * import { defineEnvVars } from "@dropletsjs/droplets/env";
 *
 * export const variables = defineEnvVars({
 *   API_KEY: {},                                     // private, read at runtime
 *   SHOW_DEBUG: { static: true },                    // private, inlined at build
 *   PUBLIC_API_URL: { public: true },                // reaches the browser, read at runtime
 *   PUBLIC_SITE_NAME: { public: true, static: true }, // reaches the browser, inlined at build
 * });
 *
 * declare module "@dropletsjs/droplets/env" {
 *   interface Register { variables: typeof variables }
 * }
 * ```
 *
 * then read them with `import { env } from "$droplets/env/private"` (server
 * code only) or `"$droplets/env/public"` (anywhere).
 */

export type EnvVarOptions = {
  /**
   * Expose the variable to the browser. Read at runtime like any other
   * unless `static`: the server hands the value to the page with
   * `/index.js`, before any droplet loads.
   */
  public?: boolean;
  /** Inline the value at build time instead of reading it at runtime. */
  static?: boolean;
};

export type EnvDeclaration = Record<string, EnvVarOptions>;

/** Register your declaration here to type `$droplets/env/*`. See above. */
// biome-ignore lint/style/useConsistentTypeDefinitions: the user merges into it; `type` cannot merge.
// biome-ignore lint/suspicious/noEmptyInterface: empty until the user merges into it.
export interface Register {}

type Declared = Register extends { variables: infer V extends EnvDeclaration } ? V : Record<string, EnvVarOptions>;

type PublicKeys<V> = {
  [K in keyof V]: V[K] extends { public: true } ? K : never;
}[keyof V];

/** Static values are checked at build time; runtime ones may be missing. */
type ValueOf<O> = O extends { static: true } ? string : string | undefined;

/** What `$droplets/env/public` exports as `env`. */
export type PublicEnv = { readonly [K in PublicKeys<Declared>]: ValueOf<Declared[K]> };

/** What `$droplets/env/private` exports as `env`. */
export type PrivateEnv = {
  readonly [K in Exclude<keyof Declared, PublicKeys<Declared>>]: ValueOf<Declared[K]>;
};

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Checks a declaration; the error says which variable is wrong and why. */
export function validateEnvDeclaration(vars: EnvDeclaration): void {
  for (const [name, options] of Object.entries(vars)) {
    if (!NAME.test(name)) {
      throw new Error(`droplets: "${name}" is not a valid environment variable name`);
    }
    if (typeof options !== "object" || options === null) {
      throw new Error(`droplets: ${name} must be declared with an options object, e.g. ${name}: {}`);
    }
  }
}

/** Declares the project's environment variables. Returns them unchanged. */
export function defineEnvVars<const T extends EnvDeclaration>(vars: T): T {
  validateEnvDeclaration(vars);
  return vars;
}
