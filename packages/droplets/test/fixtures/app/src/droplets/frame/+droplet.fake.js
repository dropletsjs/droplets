// Client-only: the server leaves an empty element and the browser mounts.
export const ssr = false;

// No load files: nothing but what the host puts in the element.
export default ({ children }) =>
  `<div class="frame" data-testid="frame"><button data-testid="toggle">close</button>${children()}</div>`;
