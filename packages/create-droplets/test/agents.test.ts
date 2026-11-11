import { describe, expect, it } from "vitest";
import { agentsMd } from "../src/agents.ts";
import { choicesWith } from "./choices-with.ts";

describe("AGENTS.md", () => {
  it("opens with the one-framework rule", () => {
    const text = agentsMd(choicesWith({ frameworks: ["svelte", "react"] }));
    const first = text.indexOf("## ");
    expect(text.slice(first)).toMatch(
      /^## The first rule: one framework per droplet\n\n\*\*Always import only the droplet's own framework in its code\.\*\*/,
    );
    expect(text).toContain("src/lib/api.ts");
    expect(text).toContain("src/lib/react/Card.tsx");
  });

  it("is written for the project's frameworks, adapters and package manager", () => {
    const text = agentsMd(choicesWith({ frameworks: ["react", "solid", "handlebars"], adapters: ["node", "deno"], pm: "pnpm" }));
    expect(text).toContain("Frameworks: React, Solid, Handlebars. Adapters: node, deno (`vite build` targets node).");
    expect(text).toContain("| `pnpm run build:deno` |");
    expect(text).toContain("pnpm exec djs add <name> --framework react");
    expect(text).toContain("`/** @jsxImportSource solid-js */`");
    expect(text).toContain("- Handlebars: the comment the template opens with");
    expect(text).not.toContain("- Svelte:");
    expect(text).toContain("/droplets/hello-react?who=Ana");
    // One JSX framework: no pragma note.
    expect(agentsMd(choicesWith({ frameworks: ["react"] }))).not.toContain("@jsxImportSource");
  });
});
