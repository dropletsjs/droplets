/** The examples under examples/frameworks, and where the e2e run serves each. */
export const EXAMPLES = ["svelte", "vue", "react", "solid", "hono-jsx", "handlebars", "preact", "lit"] as const;

export type Example = (typeof EXAMPLES)[number];

/** The host page's port: every example's page is `/<example>/` on it. */
export const HOST_PORT = 8100;

/** Each example's droplets server: 8400 for the first, then one up. */
export const dropletsPort = (example: string): number => 8400 + EXAMPLES.indexOf(example as Example);
