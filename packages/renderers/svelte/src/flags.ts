import type { ReadFlagsInput, RenderFlags } from "@dropletsjs/droplets";
import { readExportedFlags } from "@dropletsjs/droplets/vite";
import { preprocess } from "svelte/compiler";

/**
 * The flags of a component: the exports of its `<script module>` block (or
 * `<script context="module">`), and of nothing else in the file.
 */
export async function readFlags({ kind, source, file, droplet }: ReadFlagsInput): Promise<Partial<RenderFlags> | undefined> {
  let module: string | undefined;
  // Svelte's own block split: it skips HTML comments and leaves the markup and
  // styles unparsed, so a stylesheet in another language does not get in the way.
  await preprocess(
    source,
    {
      script: ({ content, attributes }) => {
        if (attributes["module"] === true || attributes["context"] === "module") {
          module = content;
        }
      },
    },
    { filename: file },
  );
  if (module === undefined) return undefined;
  const where = kind === "droplet" ? droplet : `${droplet}/${file}`;
  // TypeScript parses plain JavaScript too, whatever the block's `lang`.
  return readExportedFlags(module, where, "ts");
}
