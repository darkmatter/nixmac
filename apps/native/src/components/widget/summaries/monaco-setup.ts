import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import type { editor } from "monaco-editor";
import { initNixGrammar } from "@/lib/nix-grammar";
import { NIXMAC_THEME, NIXMAC_THEME_DATA } from "./monaco-theme";

// Use the locally bundled monaco-editor instead of CDN (required in Tauri offline context)
loader.config({ monaco });

monaco.editor.defineTheme(NIXMAC_THEME, NIXMAC_THEME_DATA);

// Eagerly register the Nix textmate grammar so FileView/DiffView pick up Nix
// highlighting without waiting for the nix-editor panel to open.
initNixGrammar(monaco).catch((e) => console.warn("Nix grammar init failed:", e));

export const FILE_VIEW_OPTIONS: editor.IStandaloneEditorConstructionOptions = {
  readOnly: true,
  minimap: { enabled: false },
  renderLineHighlight: "none",
  overviewRulerLanes: 0,
  overviewRulerBorder: false,
  scrollbar: {
    vertical: "auto",
    horizontal: "hidden",
    handleMouseWheel: true,
    alwaysConsumeMouseWheel: false,
    verticalScrollbarSize: 8,
  },
  wordWrap: "off",
  fontSize: 12,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  smoothScrolling: true,
  scrollBeyondLastLine: false,
  folding: false,
  glyphMargin: false,
  automaticLayout: true,
  padding: { top: 8, bottom: 8 },
  guides: { indentation: false, bracketPairs: false },
};

export const DIFF_EDITOR_OPTIONS = {
  readOnly: true,
  minimap: { enabled: false },
  renderLineHighlight: "none" as const,
  overviewRulerLanes: 0,
  overviewRulerBorder: false,
  hideCursorInOverviewRuler: true,
  scrollbar: {
    vertical: "auto" as const,
    horizontal: "hidden" as const,
    handleMouseWheel: true,
    alwaysConsumeMouseWheel: false,
    verticalScrollbarSize: 8,
    horizontalScrollbarSize: 0,
  },
  wordWrap: "off" as const,
  fontSize: 12,
  fontFamily:
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  smoothScrolling: true,
  scrollBeyondLastLine: false,
  folding: false,
  glyphMargin: false,
  automaticLayout: true,
  padding: { top: 8, bottom: 8 },
  guides: { indentation: false, bracketPairs: false },
  renderSideBySide: false,
  renderOverviewRuler: false,
  renderIndicators: true,
  stickyScroll: { enabled: false },
};

const EXT_TO_LANGUAGE: Record<string, string> = {
  nix: "nix", json: "json", yaml: "yaml", yml: "yaml", toml: "toml",
  md: "markdown", sh: "shell", ts: "typescript", js: "javascript",
  tsx: "typescript", jsx: "javascript", css: "css", html: "html", xml: "xml",
};

export function languageFromFilename(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return EXT_TO_LANGUAGE[ext] ?? "plaintext";
}

export { NIXMAC_THEME, NIXMAC_THEME_DATA } from "./monaco-theme";

export { monaco };
