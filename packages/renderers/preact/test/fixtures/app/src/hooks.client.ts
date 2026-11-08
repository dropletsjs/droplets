// The conformance kit's check of `init`: `/index.js` calls it before it
// defines the element.
const page = globalThis as { conformanceInit?: string[] };

export function init(): void {
  (page.conformanceInit ??= []).push(customElements.get("test-droplet") ? "defined" : "not defined");
}
