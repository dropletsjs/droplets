// For svelte-check: the test fixtures await `data`, which needs async mode,
// as test/conformance.test.ts compiles them. Vite reads none of this.
export default { compilerOptions: { experimental: { async: true } } };
