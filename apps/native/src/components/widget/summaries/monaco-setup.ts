import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";

// Use the locally bundled monaco-editor instead of CDN (required in Tauri offline context)
loader.config({ monaco });

monaco.editor.defineTheme("nixmac-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "addition.diff", foreground: "34d399" },
    { token: "deletion.diff", foreground: "f87171" },
    { token: "info.diff", foreground: "64748b" },
  ],
  colors: {
    "diffEditor.insertedLineBackground": "#34d39920",
    "diffEditor.removedLineBackground": "#f8717120",
    "diffEditor.insertedTextBackground": "#00000000",
    "diffEditor.removedTextBackground": "#00000000",
    "diffEditorGutter.insertedLineBackground": "#00000000",
    "diffEditorGutter.removedLineBackground": "#00000000",
  },
});

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

export { monaco };
