import { getShortFilename, type ChangeWithRichType } from "@/components/widget/utils";
import type { FileDiffContents } from "@/types/shared";
import { DiffEditor } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { useEffect, useRef, useState } from "react";
import { CollapsibleDiff } from "./collapsible-diff";
import { HunkPill } from "./hunk-pill";
import { DIFF_EDITOR_OPTIONS, monaco } from "./monaco-setup";

function getModStartLine(diff: string): number | null {
  const match = /@@ -\d+(?:,\d+)? \+(\d+)/.exec(diff);
  return match ? parseInt(match[1]) : null;
}

// =============================================================================
// FullFileDiffEditor
// =============================================================================

interface FullFileDiffEditorProps {
  filename: string;
  changes: ChangeWithRichType[];
  contents?: FileDiffContents;
  defaultOpen?: boolean;
}

export function FullFileDiffEditor({ filename, changes, contents, defaultOpen }: FullFileDiffEditorProps) {
  const editorRef = useRef<editor.IStandaloneDiffEditor | null>(null);
  const [isOpen, setIsOpen] = useState(defaultOpen ?? false);

  const scrollToChange = (index: number) => {
    const line = getModStartLine(changes[index].diff);
    if (line) editorRef.current?.getModifiedEditor().revealLineInCenter(line, monaco.editor.ScrollType.Smooth);
  };

  const handlePillClick = (index: number) => {
    if (!isOpen) {
      setIsOpen(true);
      setTimeout(() => scrollToChange(index), 150);
    } else {
      scrollToChange(index);
    }
  };

  const handleToggle = () => {
    if (!isOpen) {
      setIsOpen(true);
      setTimeout(() => scrollToChange(0), 150);
    } else {
      setIsOpen(false);
      editorRef.current?.setModel(null);
    }
  };

  const handleEditorMount = (ed: editor.IStandaloneDiffEditor) => {
    editorRef.current = ed;
  };

  const displayChange: ChangeWithRichType = {
    ...changes[0],
    changeType: "edited",
    shortFilename: getShortFilename(filename),
    hasMultipleHunks: true,
  };

  return (
    <CollapsibleDiff
      change={displayChange}
      open={isOpen}
      onToggle={handleToggle}
      headerExtra={
        <>
          {changes.map((c, i) => (
            <HunkPill key={c.hash} change={c} onClick={() => handlePillClick(i)} />
          ))}
        </>
      }
    >
      {contents ? (
        <InlineDiffEditor contents={contents} filename={filename} onMount={handleEditorMount} />
      ) : (
        <div className="flex items-center justify-center py-8 text-muted-foreground text-xs">
          Loading...
        </div>
      )}
    </CollapsibleDiff>
  );
}

// =============================================================================
// InlineDiffEditor (internal)
// =============================================================================

interface InlineDiffEditorProps {
  contents: FileDiffContents;
  filename: string;
  onMount: (editor: editor.IStandaloneDiffEditor) => void;
}

function InlineDiffEditor({ contents, filename, onMount }: InlineDiffEditorProps) {
  const disposableRef = useRef<monaco.IDisposable | null>(null);
  const lineCount = Math.max(
    contents.original.split("\n").length,
    contents.modified.split("\n").length,
  );

  useEffect(() => {
    return () => {
      disposableRef.current?.dispose();
      disposableRef.current = null;
    };
  }, []);

  return (
    <DiffEditor
      key={filename}
      height={Math.min(Math.max(lineCount * 19, 100), 400)}
      original={contents.original}
      modified={contents.modified}
      theme="nixmac-dark"
      options={DIFF_EDITOR_OPTIONS}
      onMount={(ed) => {
        onMount(ed);
        ed.getOriginalEditor().updateOptions({ lineNumbers: "off" });

        const decorate = () => {
          try {
            const diffs = ed.getLineChanges() ?? [];
            ed.getModifiedEditor().createDecorationsCollection(
              diffs
                .filter((d) => d.modifiedEndLineNumber > 0)
                .map((d) => ({
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
