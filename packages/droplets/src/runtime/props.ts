/**
 * Props validation and the key a prop set is stored under at build. Shared
 * by the server and the browser: no Node APIs, no framework imports.
 */

/** The part of Standard Schema (`~standard`) the framework calls. */
export type StandardSchema = {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => StandardResult | Promise<StandardResult>;
  };
};

/**
 * What a Standard Schema produces: its declared output type, or the props
 * unchanged when `schema` is not one. The generated `./$types` types a
 * droplet's props with it.
 */
export type InferSchemaOutput<Schema> = Schema extends {
  readonly "~standard": { readonly types?: infer Types };
}
  ? NonNullable<Types> extends { readonly output: infer Output }
    ? Output
    : Record<string, unknown>
  : Record<string, unknown>;

type StandardIssue = {
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined;
};

type StandardResult = { readonly value: unknown; readonly issues?: undefined } | { readonly issues: ReadonlyArray<StandardIssue> };

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

export function isStandardSchema(value: unknown): value is StandardSchema {
  if (typeof value !== "object" && typeof value !== "function") return false;
  if (value === null) return false;
  const standard = (value as { "~standard"?: { validate?: unknown } })["~standard"];
  return typeof standard?.validate === "function";
}

type FormatIssuesInput = { issues: ReadonlyArray<StandardIssue> };

function formatIssues({ issues }: FormatIssuesInput): string {
  const parts = issues.map((issue) => {
    const path = (issue.path ?? []).map((segment) => String(typeof segment === "object" ? segment.key : segment)).join(".");
    return path ? `${path}: ${issue.message}` : issue.message;
  });
  return `Invalid props${parts.length ? `: ${parts.join("; ")}` : ""}`;
}

/**
 * Runs `props` from `+droplet.ts` over what the caller sent. The schema's
 * output replaces the props, so coercions and defaults apply. Without a
 * schema the props pass through unchanged.
 */
export async function validateProps(droplet: string, schema: unknown, props: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (schema === undefined) return props;
  if (!isStandardSchema(schema)) {
    throw new Error(`${droplet}: \`props\` in +droplet.ts must be a Standard Schema (zod, valibot, arktype…)`);
  }
  const result = await schema["~standard"].validate(props);
  if (result.issues) throw new PropsError({ issues: result.issues });
  const value = result.value;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${droplet}: the props schema must produce an object`);
  }
  return value as Record<string, unknown>;
}

/**
 * The prop set as a string that does not depend on key order: what a
 * prerendered render is looked up by. `{ page: 2 }` and `?page=2` meet here
 * once the schema has coerced them to the same value.
 */
export function propsKey(props: Record<string, unknown>): string {
  return JSON.stringify(sortKeys({ value: props }));
}

/**
 * What a build-time render is stored under: its `propsKey`, and, for a
 * render made for a known host, that host's origin and path (never its
 * query). The host-agnostic render of the same props has the `propsKey` alone.
 */
export function prerenderKey(key: string, host?: URL): string {
  return host ? `${key} ${host.origin}${host.pathname}` : key;
}

type SortKeysInput = { value: unknown };

function sortKeys({ value }: SortKeysInput): unknown {
  if (Array.isArray(value)) return value.map((item: unknown) => sortKeys({ value: item }));
  if (typeof value !== "object" || value === null) return value;
  if (typeof (value as { toJSON?: unknown }).toJSON === "function") return value;
  // No prototype: a `__proto__` key is a key like any other.
  const sorted: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortKeys({ value: (value as Record<string, unknown>)[key] });
  }
  return sorted;
}
