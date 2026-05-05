import type { FileDiffContents } from "@/types/shared";
import { DiffEditor as MonacoDiffEditor } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { useEffect, useRef } from "react";
import { DIFF_EDITOR_OPTIONS, monaco } from "./monaco-setup";

interface DiffEditorProps {
  contents: FileDiffContents;
  filename: string;
  onMount: (editor: editor.IStandaloneDiffEditor) => void;
}

export function DiffEditor({ contents, filename, onMount }: DiffEditorProps) {
  const disposableRef = useRef<monaco.IDisposable | null>(null);
  const editorRef = useRef<editor.IStandaloneDiffEditor | null>(null);
  const lineCount = Math.max(
    contents.original.split("\n").length,
    contents.modified.split("\n").length,
  );

  useEffect(() => {
    return () => {
      editorRef.current?.setModel(null);
      disposableRef.current?.dispose();
      disposableRef.current = null;
    };
  }, []);

  return (
    <MonacoDiffEditor
      key={filename}
      height={Math.min(Math.max(lineCount * 19, 100), 400)}
      original={contents.original}
      modified={contents.modified}
      theme="nixmac-dark"
      options={DIFF_EDITOR_OPTIONS}
      onMount={(ed: editor.IStandaloneDiffEditor) => {
        editorRef.current = ed;
        onMount(ed);
        ed.getOriginalEditor().updateOptions({ lineNumbers: "off" });

        const decorate = () => {
          try {
            const diffs = ed.getLineChanges() ?? [];
            ed.getModifiedEditor().createDecorationsCollection(
              diffs
                .filter((d: editor.ILineChange) => d.modifiedEndLineNumber > 0)
                .map((d: editor.ILineChange) => ({
                  range: new monaco.Range(d.modifiedStartLineNumber, 1, d.modifiedEndLineNumber, 10000),
                  options: {
                    inlineClassName: "nixmac-line-added",
                    linesDecorationsClassName: "nixmac-gutter-added",
                  },
                })),
            );
          } catch { /* editor disposed */ }
        };

        disposableRef.current = ed.onDidUpdateDiff(decorate);
        decorate();
      }}
    />
  );
}
