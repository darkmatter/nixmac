import { useState } from "react";
import { Braces, ChevronDown, ChevronRight, MessageSquarePlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { FsFile } from "./data";
import { TONE_CLASSES } from "./data";
import { highlightNix } from "./highlight";
import { resolveIcon } from "./icons";

interface FileRowProps {
  file: FsFile;
  /**
   * Called when the user wants to ask the AI to change this file. The
   * caller is expected to seed the prompt textarea and route back to
   * BeginStep.
   */
  onEditWithPrompt: (file: FsFile) => void;
}

export function FileRow({ file, onEditWithPrompt }: FileRowProps) {
  const [peeked, setPeeked] = useState(false);
  const tone = TONE_CLASSES[file.tone];
  const Icon = resolveIcon(file.iconName);
  const peekable = !!file.nix;

  return (
    <div className="border-border/50 border-b">
      <div className="grid grid-cols-[auto_1fr_auto] items-start gap-3 px-3 py-2.5">
        <span
          className={cn(
            "mt-0.5 flex h-7 w-7 items-center justify-center rounded-md",
            tone.bg,
            tone.fg,
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium text-[12.5px]">{file.title}</span>
            {file.status === "changed" && (
              <span className="rounded-sm bg-amber-500/15 px-1 py-px font-semibold text-[9.5px] text-amber-400">
                {file.changedNote ?? "changed"}
              </span>
            )}
            {file.status === "candidate" && (
              <span className="rounded-sm border border-amber-500/40 border-dashed bg-amber-500/10 px-1 py-px font-semibold text-[9.5px] text-amber-400">
                untracked
              </span>
            )}
            {file.readonly && (
              <span className="rounded-sm bg-muted px-1 py-px font-semibold text-[9.5px] text-muted-foreground">
                read-only
              </span>
            )}
          </div>
          <div className="mt-0.5 truncate font-mono text-[10.5px] text-muted-foreground">
            {file.path}
          </div>
          <div className="mt-1 line-clamp-2 text-[11.5px] text-muted-foreground">
            {file.description}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {peekable && (
            <button
              type="button"
              onClick={() => setPeeked((v) => !v)}
              className={cn(
                "flex h-7 items-center gap-1 rounded-md border border-border bg-card/40 px-2 text-[11px] text-muted-foreground transition-colors hover:bg-card hover:text-foreground",
                peeked && "border-teal-500/40 text-teal-300",
              )}
              aria-expanded={peeked}
              aria-label={peeked ? "Hide nix source" : "Show nix source"}
            >
              <Braces className="h-3 w-3" />
              {peeked ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            </button>
          )}
          {!file.readonly && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 border-teal-500/30 bg-teal-500/10 text-[11px] text-teal-300 hover:bg-teal-500/15 hover:text-teal-200"
              onClick={() => onEditWithPrompt(file)}
              data-testid={`edit-with-prompt-${file.id}`}
            >
              <MessageSquarePlus className="h-3 w-3" />
              Edit with a prompt
            </Button>
          )}
        </div>
      </div>
      {peeked && file.nix && (
        <pre className="m-0 max-h-[280px] overflow-auto whitespace-pre border-border/40 border-t bg-card/30 p-3 font-mono text-[11.5px] leading-[1.55]">
          {highlightNix(file.nix)}
        </pre>
      )}
    </div>
  );
}
