/** Type stub for `$droplets/form`; the plugin generates the real module. */
import type { ActionMap, ActionName } from "../runtime/enhance.ts";

export type {
  ActionEnhanceOptions,
  ActionMap,
  ActionName,
  AnyEnhanceOptions,
  DropletActionDetail,
  EnhanceOptions,
  EnhanceResult,
  EnhanceSubmit,
} from "../runtime/enhance.ts";
export { enhanceDropletForm } from "../runtime/enhance.ts";

export type ActionUrlOptions = {
  /** The droplet; the one rendering when absent. Required outside a render. */
  droplet?: string;
  /** Its props (strings, numbers and booleans travel in the URL); the rendering droplet's when absent. */
  props?: Record<string, unknown>;
};

type ActionUrlArgs<A extends ActionMap> = "default" extends keyof A
  ? [name?: ActionName<A>, options?: ActionUrlOptions]
  : [name: ActionName<A>, options?: ActionUrlOptions];

/**
 * `${location}/droplets/<id>?/<name>`: the action `name` (`default`
 * without one) of the droplet rendering now, on the droplets server's
 * location. Throws outside a render without `{ droplet }`.
 */
export const actionUrl = (() => "") as <A extends ActionMap = ActionMap>(...args: ActionUrlArgs<A>) => string;
export default actionUrl;
