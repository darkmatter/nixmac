import type { FileDiffContents } from "@/ipc/types";
import { DiffEditor } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { useEffect, useRef } from "react";
import { DIFF_EDITOR_OPTIONS, monaco, NIXMAC_THEME, NIXMAC_THEME_DATA } from "./monaco-setup";

interface DiffViewProps {
  contents: FileDiffContents;
  filename: string;
  onMount: (editor: editor.IStandaloneDiffEditor) => void;
  disableRuntime?: boolean;
}

export function DiffView({ contents, filename, onMount, disableRuntime = false }: DiffViewProps) {
  const disposableRef = useRef<monaco.IDisposable | null>(null);
  const editorRef = useRef<editor.IStandaloneDiffEditor | null>(null);
  const lineCount = Math.max(
    contents.original.split("\n").length,
    contents.modified.split("\n").length,
  );
  const height = Math.min(Math.max(lineCount * 19, 100), 400);

  // null model on non-collapse unmount (e.g. routing) to prevent monaco crashes
  useEffect(() => {
    return () => {
      editorRef.current?.setModel(null);
      disposableRef.current?.dispose();
      disposableRef.current = null;
    };
  }, []);

  return disableRuntime ? (
    <section
      data-testid="monaco-diff-view"
      style={{ display: "flex", position: "relative", textAlign: "initial", width: "100%", height }}
    >
      <div data-keybinding-context="N" style={{ width: "100%" }}>
        <div className="monaco-diff-editor" style={{ position: "relative", height }}>
          <div data-slot="monaco-editor-placeholder" />
        </div>
      </div>
    </section>
  ) : (
    <DiffEditor
      key={filename}
      height={height}
      original={contents.original}
      modified={contents.modified}
      theme={NIXMAC_THEME}
      options={DIFF_EDITOR_OPTIONS}
      wrapperProps={{ "data-testid": "monaco-diff-view" }}
      beforeMount={(m) => m.editor.defineTheme(NIXMAC_THEME, NIXMAC_THEME_DATA)}
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
                  range: new monaco.Range(
                    d.modifiedStartLineNumber,
                    1,
                    d.modifiedEndLineNumber,
                    10000,
                  ),
                  options: {
                    inlineClassName: "nixmac-line-added",
                    linesDecorationsClassName: "nixmac-gutter-added",
                  },
                })),
            );
          } catch {
            /* editor disposed */
          }
        };

        disposableRef.current = ed.onDidUpdateDiff(decorate);
        decorate();
      }}
    />
  );
}
