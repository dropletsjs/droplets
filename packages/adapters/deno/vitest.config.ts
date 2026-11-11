import { loadEnvLocal } from "@dropletsjs/shared/env";
import { adapterTests } from "@dropletsjs/shared/vitest";

// `DENO`: a deno binary off the PATH.
loadEnvLocal();

export default adapterTests;
