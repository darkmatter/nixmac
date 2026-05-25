import type { FileDiffContents } from "@/ipc/types";
import { Editor } from "@monaco-editor/react";
import { languageFromFilename, NIXMAC_THEME, NIXMAC_THEME_DATA, FILE_VIEW_OPTIONS } from "./monaco-setup";

interface FileViewProps {
  contents: FileDiffContents;
  filename: string;
}

export function FileView({ contents, filename }: FileViewProps) {
  const value = contents.modified;
  const lineCount = value.split("\n").length;

  return (
    <Editor
      key={filename}
      height={Math.min(Math.max(lineCount * 19, 100), 400)}
      defaultLanguage={languageFromFilename(filename)}
      value={value}
      theme={NIXMAC_THEME}
      options={FILE_VIEW_OPTIONS}
      wrapperProps={{ "data-testid": "monaco-file-view" }}
      beforeMount={(m) => m.editor.defineTheme(NIXMAC_THEME, NIXMAC_THEME_DATA)}
    />
  );
}
