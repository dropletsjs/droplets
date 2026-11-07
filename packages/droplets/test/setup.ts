import { setLogLevel } from "../src/core/logger.ts";

// Keep test output quiet; individual tests raise the level when they assert on it.
setLogLevel("error");
