// The error page carries its styles with its markup.
export const head = "<style>.oops { color: crimson; }</style>";

export default ({ error, children }) =>
  `<p class="oops" data-testid="error">${error.message}</p>` +
  `<button data-testid="retry">0</button>` +
  `<div data-testid="error-children">${children()}</div>`;

export function attach(target) {
  const button = target.querySelector("[data-testid=retry]");
  let tries = 0;
  const onClick = () => {
    tries += 1;
    button.textContent = String(tries);
  };
  button?.addEventListener("click", onClick);
  return () => button?.removeEventListener("click", onClick);
}
