import { loadEnvLocal } from "@dropletsjs/shared/env";
import { adapterTests } from "@dropletsjs/shared/vitest";

// `BUN`: a bun binary off the PATH.
loadEnvLocal();

export default adapterTests;
