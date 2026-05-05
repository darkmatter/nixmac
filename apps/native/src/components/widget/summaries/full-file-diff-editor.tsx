import { getShortFilename, type ChangeWithRichType } from "@/components/widget/utils";
import type { FileDiffContents } from "@/types/shared";
import type { editor } from "monaco-editor";
import { useRef, useState } from "react";
import { CollapsibleDiff } from "./collapsible-diff";
import { HunkPill } from "./hunk-pill";
import { DiffEditor } from "./diff-editor";
import { monaco } from "./monaco-setup";
import { PlainEditor } from "./plain-editor";

function getModStartLine(diff: string): number | null {
  const match = /@@ -\d+(?:,\d+)? \+(\d+)/.exec(diff);
  return match ? parseInt(match[1]) : null;
}

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
            <HunkPill key={c.hash} change={c} onClick={() => handlePillClick(i)} />
          ))}
        </>
      }
    >
      {contents ? (
        changeType === "new" || changeType === "removed" ? (
          <PlainEditor contents={contents} filename={filename} changeType={changeType} />
        ) : (
          <DiffEditor contents={contents} filename={filename} onMount={(ed) => { editorRef.current = ed; }} />
        )
      ) : (
        <div className="flex items-center justify-center py-8 text-muted-foreground text-xs">
          Loading...
        </div>
      )}
    </CollapsibleDiff>
  );
}
