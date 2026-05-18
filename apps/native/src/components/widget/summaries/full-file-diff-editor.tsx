import { getShortFilename, type ChangeWithRichType } from "@/components/widget/utils";
import type { FileDiffContents } from "@/types/shared";
import type { editor } from "monaco-editor";
import { useRef } from "react";
import { CollapsibleDiff } from "./collapsible-diff";
import { HunkPill } from "./hunk-pill";
import { DiffView } from "./diff-view";
import { monaco } from "./monaco-setup";
import { FileView } from "./file-view";

function getModStartLine(diff: string): number | null {
  const match = /@@ -\d+(?:,\d+)? \+(\d+)/.exec(diff);
  return match ? parseInt(match[1]) : null;
}

interface FullFileDiffEditorProps {
  filename: string;
  changes: ChangeWithRichType[];
  contents?: FileDiffContents;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

export function FullFileDiffEditor({ filename, changes, contents, isOpen, onOpenChange }: FullFileDiffEditorProps) {
  const editorRef = useRef<editor.IStandaloneDiffEditor | null>(null);
  const pendingScrollLineRef = useRef<number | null>(
    isOpen ? getModStartLine(changes[0].diff) : null,
  );

  const handleMount = (ed: editor.IStandaloneDiffEditor) => {
    editorRef.current = ed;
    const pending = pendingScrollLineRef.current;
    pendingScrollLineRef.current = null;
    if (pending != null) {
      ed.getModifiedEditor().revealLineInCenter(pending, monaco.editor.ScrollType.Immediate);
    }
  };

  const focusChange = (index: number) => {
    const line = getModStartLine(changes[index].diff);
    const target = line && line > 0 ? line : null;
    if (!isOpen) {
      pendingScrollLineRef.current = target;
      onOpenChange(true);
      return;
    }
    if (target != null) {
      editorRef.current?.getModifiedEditor().revealLineInCenter(target, monaco.editor.ScrollType.Smooth);
    }
  };

  const handleToggle = () => {
    if (isOpen) {
      onOpenChange(false);
      editorRef.current?.setModel(null);
    } else {
      focusChange(0);
    }
  };

  const displayChange: ChangeWithRichType = {
    ...changes[0],
    shortFilename: getShortFilename(filename),
    hasMultipleHunks: changes.length > 1,
  };

  const changeType = displayChange.changeType;

  return (
    <CollapsibleDiff
      change={displayChange}
      open={isOpen}
      onToggle={handleToggle}
      headerExtra={
        <>
          {changes.map((c, i) => (
            <HunkPill key={c.hash} change={c} onClick={() => focusChange(i)} />
          ))}
        </>
      }
    >
      {contents ? (
        changeType === "new" ? (
          <FileView contents={contents} filename={filename} />
        ) : (
          <DiffView contents={contents} filename={filename} onMount={handleMount} />
        )
      ) : (
        <div className="flex items-center justify-center py-8 text-muted-foreground text-xs">
          Loading...
        </div>
      )}
    </CollapsibleDiff>
  );
}
