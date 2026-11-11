/**
 * `import styles from "./x.css"`: the stylesheet's text, inlined when this
 * package is built (`loader: { ".css": "text" }` in
 * packages/tsdown.config.base.ts), so consumers need no `?inline`. For the
 * type check only: no published `.d.ts` refers to it.
 */
declare module "*.css" {
  const text: string;
  export default text;
}
