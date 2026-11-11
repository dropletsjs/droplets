import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { nameProblem } from "../../src/add/add.ts";
import type { Project } from "../../src/add/project.ts";

describe("nameProblem", () => {
  let root: string;
  let project: Pick<Project, "api">;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "droplets-add-"));
    project = { api: { droplets: () => [{ id: "taken" }], dropletsRoot: () => root } as unknown as Project["api"] };
  });
  afterAll(() => rm(root, { recursive: true, force: true }));

  it("takes a lowercase kebab-case name, the droplet's id as it is", () => {
    for (const name of ["hello", "hello-world", "card2"]) expect(nameProblem({ name, project }), name).toBeUndefined();
  });

  it("refuses a name discovery would ignore", () => {
    for (const name of ["HelloWorld", "Hello", "hello_world", "hello--world", "hello-", "2fa"]) {
      expect(nameProblem({ name, project }), name).toBe("lowercase kebab-case, starting with a letter: hello-world");
    }
  });

  it("refuses an id that exists", () => {
    expect(nameProblem({ name: "taken", project })).toBe('a droplet with the id "taken" exists already');
  });
});
