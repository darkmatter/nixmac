import type { FileDiffContents } from "@/ipc/types";
import { Editor } from "@monaco-editor/react";
import { languageFromFilename, NIXMAC_THEME, NIXMAC_THEME_DATA, FILE_VIEW_OPTIONS } from "./monaco-setup";

interface FileViewProps {
  contents: FileDiffContents;
  filename: string;
  disableRuntime?: boolean;
}

export function FileView({ contents, filename, disableRuntime = false }: FileViewProps) {
  const value = contents.modified;
  const lineCount = value.split("\n").length;
  const height = Math.min(Math.max(lineCount * 19, 100), 400);
  const language = languageFromFilename(filename);

  if (disableRuntime) {
    return (
      <section
        data-testid="monaco-file-view"
        style={{ display: "flex", position: "relative", textAlign: "initial", width: "100%", height }}
      >
        <div data-keybinding-context="N" data-mode-id={language} style={{ width: "100%" }}>
          <div className="monaco-editor" role="code" data-uri="inmemory://model/N" style={{ width: "100%", height }}>
            <div data-slot="monaco-editor-placeholder" />
          </div>
        </div>
      </section>
    );
  }

  return (
    <Editor
      key={filename}
      height={height}
      defaultLanguage={language}
      value={value}
      theme={NIXMAC_THEME}
      options={FILE_VIEW_OPTIONS}
      wrapperProps={{ "data-testid": "monaco-file-view" }}
      beforeMount={(m) => m.editor.defineTheme(NIXMAC_THEME, NIXMAC_THEME_DATA)}
    />
  );
}
