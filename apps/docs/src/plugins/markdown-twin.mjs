/**
 * Every page's Markdown twin: `guides/configuration` is served at
 * `/guides/configuration.md`, the home page (slug `index`, Starlight route id
 * `""`) at `/index.md`. `llmsTxt` writes the files; the head link and the
 * page actions point at them.
 */

/** @param {string} slug */
export const twinFile = (slug) => `${slug && slug !== "index" ? slug : "index"}.md`;

/**
 * The twin's root-relative URL, base path included: `baseLinks` only rewrites `<a href>`.
 * @param {string} slug
 * @param {string} base
 */
export const twinHref = (slug, base) => `${base.replace(/\/+$/, "")}/${twinFile(slug)}`;
