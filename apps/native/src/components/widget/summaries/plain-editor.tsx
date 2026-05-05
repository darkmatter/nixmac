import type { FileDiffContents } from "@/types/shared";
import { Editor } from "@monaco-editor/react";
import { languageFromFilename, PLAIN_EDITOR_OPTIONS } from "./monaco-setup";

interface PlainEditorProps {
  contents: FileDiffContents;
  filename: string;
  changeType: "new" | "removed";
}

export function PlainEditor({ contents, filename, changeType }: PlainEditorProps) {
  const value = changeType === "new" ? contents.modified : contents.original;
  const lineCount = value.split("\n").length;

  return (
    <Editor
      key={filename}
      height={Math.min(Math.max(lineCount * 19, 100), 400)}
      defaultLanguage={languageFromFilename(filename)}
      value={value}
      theme="nixmac-dark"
      options={PLAIN_EDITOR_OPTIONS}
    />
  );
}
