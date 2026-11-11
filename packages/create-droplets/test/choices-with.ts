import { expect } from "vitest";
import type { Choices } from "../src/choices.ts";
import { frameworkNamed } from "../src/shared.ts";

export type ChoicesWithInput = Partial<Omit<Choices, "frameworks">> & { frameworks?: string[] };

/** Choices for `acme-widgets` (Svelte, Node, npm), with frameworks by name. */
export function choicesWith({ frameworks = ["svelte"], ...rest }: ChoicesWithInput = {}): Choices {
  return {
    folder: "acme-widgets",
    name: "acme-widgets",
    element: "acme-widgets",
    adapters: ["node"],
    tailwind: false,
    injectTool: false,
    claude: false,
    pm: "npm",
    ...rest,
    frameworks: frameworks.map((name) => frameworkNamed({ name }) ?? expect.unreachable(name)),
  };
}
