import type { ReadFlagsInput, RenderFlags } from "@dropletsjs/droplets";
import { readExportedFlags } from "@dropletsjs/droplets/vite";
import { parse } from "vue/compiler-sfc";

/**
 * The flags of a component: the exports of its plain `<script>` block, the
 * only one that can export (`<script setup>` cannot).
 */
export function readFlags({ kind, source, file, droplet }: ReadFlagsInput): Partial<RenderFlags> | undefined {
  const script = parse(source, { filename: file }).descriptor.script;
  if (!script) return undefined;
  const where = kind === "droplet" ? droplet : `${droplet}/${file}`;
  // TypeScript parses plain JavaScript too; JSX needs its own language.
  return readExportedFlags(script.content, where, script.lang === "tsx" || script.lang === "jsx" ? "tsx" : "ts");
}
