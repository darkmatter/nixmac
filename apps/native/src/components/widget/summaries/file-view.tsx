import type { FileDiffContents } from "@/types/shared";
import { Editor } from "@monaco-editor/react";
import { languageFromFilename, NIXMAC_THEME, NIXMAC_THEME_DATA, FILE_VIEW_OPTIONS } from "./monaco-setup";

interface FileViewProps {
  contents: FileDiffContents;
  filename: string;
  changeType: "new" | "removed";
}

export function FileView({ contents, filename, changeType }: FileViewProps) {
  const value = changeType === "new" ? contents.modified : contents.original;
  const lineCount = value.split("\n").length;

  return (
    <Editor
      key={filename}
      height={Math.min(Math.max(lineCount * 19, 100), 400)}
      defaultLanguage={languageFromFilename(filename)}
      value={value}
      theme={NIXMAC_THEME}
      options={FILE_VIEW_OPTIONS}
      beforeMount={(m) => m.editor.defineTheme(NIXMAC_THEME, NIXMAC_THEME_DATA)}
    />
  );
}
