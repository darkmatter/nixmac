import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import type { editor } from "monaco-editor";

// Use the locally bundled monaco-editor instead of CDN (required in Tauri offline context)
loader.config({ monaco });

monaco.editor.defineTheme("nixmac-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "", foreground: "fafafa" },
    { token: "comment", foreground: "a3a3a3", fontStyle: "italic" },
    { token: "string", foreground: "23d0e7" },
    { token: "string.escape", foreground: "f7b23b" },
    { token: "keyword", foreground: "55a0f6" },
    { token: "keyword.control", foreground: "55a0f6" },
    { token: "keyword.operator", foreground: "a3a3a3" },
    { token: "constant", foreground: "f7b23b" },
    { token: "constant.language", foreground: "f7b23b" },
    { token: "constant.numeric", foreground: "f7b23b" },
    { token: "number", foreground: "f7b23b" },
    { token: "type", foreground: "55a0f6" },
    { token: "type.identifier", foreground: "55a0f6" },
    { token: "entity.name.function", foreground: "23d0e7" },
    { token: "entity.name.type", foreground: "55a0f6" },
    { token: "entity.name.tag", foreground: "f4587c" },
    { token: "support.function", foreground: "23d0e7" },
    { token: "variable.parameter", foreground: "f7b23b" },
    { token: "invalid", foreground: "f4587c" },
    { token: "addition.diff", foreground: "23d0e7" },
    { token: "deletion.diff", foreground: "f4587c" },
    { token: "info.diff", foreground: "a3a3a3" },
  ],
  colors: {
    "editor.background": "#0a0a0a",
    "editor.foreground": "#fafafa",
    "editorLineNumber.foreground": "#404040",
    "editorLineNumber.activeForeground": "#a3a3a3",
    "editor.selectionBackground": "#23d0e730",
    "editor.inactiveSelectionBackground": "#23d0e718",
    "editor.lineHighlightBackground": "#141414",
    "editorCursor.foreground": "#23d0e7",
    "editorGutter.background": "#0a0a0a",
    "editorGutter.addedBackground": "#23d0e740",
    "editorGutter.deletedBackground": "#f4587c40",
    "editorGutter.modifiedBackground": "#f7b23b40",
    "scrollbarSlider.background": "#26262680",
    "scrollbarSlider.hoverBackground": "#404040aa",
    "scrollbarSlider.activeBackground": "#555555aa",
    "editorWidget.background": "#141414",
    "editorWidget.border": "#262626",
    "diffEditor.insertedLineBackground": "#23d0e715",
    "diffEditor.removedLineBackground": "#f4587c15",
    "diffEditor.insertedTextBackground": "#00000000",
    "diffEditor.removedTextBackground": "#00000000",
    "diffEditorGutter.insertedLineBackground": "#00000000",
    "diffEditorGutter.removedLineBackground": "#00000000",
  },
});

export const PLAIN_EDITOR_OPTIONS: editor.IStandaloneEditorConstructionOptions = {
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

export const NIXMAC_THEME = "nixmac-dark";

export { monaco };
