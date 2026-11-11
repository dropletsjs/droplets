import type { DropletScript } from "./$types";

/** An element with a class and, optionally, its text. */
function make<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = "") {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

/**
 * Runs in the browser only, once per element. The server sent what its load
 * returned and an empty `el`: everything below is built here, from `data`.
 */
const counter: DropletScript = (data, el) => {
  let added = 0;

  const card = make("section", "demo-card");
  card.dataset["hydrated"] = "true";
  const head = make("p", "demo-row");
  head.append(make("span", "demo-tag", `counter · ${data.framework}`));
  const row = make("p", "demo-row");
  const count = make("output", "demo-title", String(data.start));
  count.setAttribute("aria-live", "polite");
  const button = make("button", "demo-button", "Add one");
  button.type = "button";
  const onClick = () => (count.textContent = String(data.start + ++added));
  button.addEventListener("click", onClick);
  row.append(count, button);
  card.append(head, row, make("p", "demo-muted", "Built in the browser: the server sent the data and an empty element."));
  el.append(card);

  // The cleanup, when the element leaves the page; `el` is emptied after it.
  return () => button.removeEventListener("click", onClick);
};

export default counter;
