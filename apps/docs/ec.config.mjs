// Expressive Code, the code blocks of the docs: Starlight reads this file
// (not astro.config.mjs) so that <Code> in a component, which the renderer
// pages use for the demo's own sources, gets the same options. A function
// such as customizeTheme cannot be serialized from the Astro config.
//
// Code blocks in the Droplets theme: GitHub syntax colors on
// surface-300, hairline frames, 4px corners. The `--djs-*` variables come
// from the design tokens in src/styles/tokens.css and switch with the theme.
import { defineEcConfig } from "@astrojs/starlight/expressive-code";

export default defineEcConfig({
  themes: ["github-dark", "github-light"],
  useStarlightUiThemeColors: true,
  customizeTheme(theme) {
    const dark = theme.type === "dark";
    // The real editor background (surface-300), so Expressive Code's
    // contrast correction works against the color readers see.
    theme.bg = dark ? "#20252a" : "#eef0f2";
    theme.colors["editor.background"] = theme.bg;
    theme.colors["titleBar.border"] = "var(--djs-line)";
    theme.colors["editorGroupHeader.tabsBorder"] = "var(--djs-line)";
    theme.colors["titleBar.activeBackground"] = "var(--djs-surface-200)";
    theme.colors["editorGroupHeader.tabsBackground"] = "var(--djs-surface-200)";
    theme.colors["tab.activeBorderTop"] = "var(--djs-accent)";
    theme.styleOverrides.frames = {
      ...theme.styleOverrides.frames,
      editorBackground: "var(--djs-surface-300)",
      terminalBackground: "var(--djs-surface-300)",
      editorActiveTabBackground: "var(--djs-surface-300)",
      terminalTitlebarDotsForeground: "var(--djs-line-strong)",
      frameBoxShadowCssValue: "none",
    };
    return theme;
  },
  styleOverrides: {
    borderRadius: "4px",
    borderColor: "var(--djs-line)",
    codeFontFamily: "var(--__sl-font-mono)",
    codeFontSize: "var(--sl-text-code)",
    codeLineHeight: "1.6",
    uiFontSize: "var(--sl-text-xs)",
  },
});
