/**
 * `enhance(options?)`: progressive enhancement for one form of a Lit
 * droplet, opt-in, as an element directive. It applies `enhanceDropletForm`
 * of `@dropletsjs/droplets/enhance` to the form it is on, from the moment
 * the form is in the browser (hydrated or mounted) until it goes; options
 * are read at each submit, so they may change between renders.
 *
 * ```ts
 * import { html } from "lit";
 * import { DropletElement } from "@dropletsjs/renderer-lit/element";
 * import { enhance } from "@dropletsjs/renderer-lit/form";
 * import type { DropletActions, DropletProps } from "./$types";
 *
 * export default class Cart extends DropletElement<DropletProps> {
 *   override render() {
 *     return html`<form method="post" action=${this.actionUrl("add")} ${enhance<DropletActions>({ action: "add" })}>…</form>`;
 *   }
 * }
 * ```
 *
 * The form lives in the component's shadow root: the submit event does not
 * leave it, so the `data-droplet-enhance` attribute, which `/index.js`
 * handles on the droplet element, cannot reach it. Without `enhance()` the
 * form posts as any form does, and Post/Redirect/Get works as for every
 * other renderer. On the server the directive renders nothing.
 */
import { noChange, nothing, type ElementPart } from "lit";
import { AsyncDirective, directive, PartType, type DirectiveResult, type PartInfo } from "lit/async-directive.js";
import {
  enhanceDropletForm,
  type ActionEnhanceOptions,
  type ActionMap,
  type AnyEnhanceOptions,
  type EnhanceOptions,
} from "@dropletsjs/droplets/enhance";

// A class: a Lit directive that outlives a render is an `AsyncDirective` subclass.
class EnhanceDirective extends AsyncDirective {
  #form: HTMLFormElement | null = null;
  #options: EnhanceOptions | undefined;
  #release: (() => void) | null = null;

  constructor(part: PartInfo) {
    super(part);
    if (part.type !== PartType.ELEMENT) throw new Error("enhance() goes on a <form> element: <form ${enhance()}>");
  }

  render(_options?: EnhanceOptions): unknown {
    return nothing;
  }

  override update(part: ElementPart, [options]: [EnhanceOptions?]): unknown {
    this.#options = options;
    const form = part.element;
    if (!(form instanceof HTMLFormElement)) throw new Error(`enhance() goes on a <form> element, not <${form.localName}>`);
    if (form !== this.#form) {
      this.#release?.();
      this.#form = form;
      this.#bind();
    }
    return noChange;
  }

  #bind(): void {
    if (!this.#form) return;
    const latest = () => this.#options;
    this.#release = enhanceDropletForm(this.#form, {
      get action() {
        return latest()?.action;
      },
      onSubmit: (submit) => latest()?.onSubmit?.(submit),
      onResult: (result) => {
        const onResult = latest()?.onResult;
        return onResult ? onResult(result) : result.update();
      },
    });
  }

  protected override disconnected(): void {
    this.#release?.();
    this.#release = null;
  }

  protected override reconnected(): void {
    this.#bind();
  }
}

const enhanceDirective = directive(EnhanceDirective);

/** Enhances the form it is on: a submit to any of the droplet's actions, or only to `options.action`. */
export function enhance<A extends ActionMap = ActionMap>(options?: AnyEnhanceOptions<A>): DirectiveResult<typeof EnhanceDirective>;
export function enhance<A extends ActionMap = ActionMap>(options: ActionEnhanceOptions<A>): DirectiveResult<typeof EnhanceDirective>;
export function enhance(options?: EnhanceOptions): DirectiveResult<typeof EnhanceDirective> {
  return enhanceDirective(options);
}
