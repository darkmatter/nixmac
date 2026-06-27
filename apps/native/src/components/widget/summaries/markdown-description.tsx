"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MarkdownContent } from "@/components/widget/summaries/markdown-content";
import { shouldExpandDescription } from "@/components/widget/summaries/markdown-utils";
import { cn } from "@/lib/utils";
import { useState } from "react";

interface MarkdownDescriptionProps {
  text: string;
  modalTitle?: string;
  maxLines?: number;
  className?: string;
}

export function MarkdownDescription({
  text,
  modalTitle,
  maxLines = 2,
  className,
}: MarkdownDescriptionProps) {
  const [open, setOpen] = useState(false);
  const trimmed = text.trim();

  if (!trimmed) {
    return null;
  }

  const isExpandable = shouldExpandDescription(trimmed, maxLines);

  return (
    <>
      <button
        className={cn(
          "mt-1 block w-full text-left text-[12px] leading-snug text-neutral-400",
          isExpandable &&
            "cursor-pointer rounded-sm transition-colors hover:text-neutral-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20",
          className,
        )}
        onClick={() => isExpandable && setOpen(true)}
        type="button"
      >
        <span
          className={cn(
            "block whitespace-pre-wrap",
            maxLines === 2 && "line-clamp-2",
            maxLines === 3 && "line-clamp-3",
            maxLines === 4 && "line-clamp-4",
          )}
        >
          {trimmed}
        </span>
      </button>

      {isExpandable && (
        <Dialog onOpenChange={setOpen} open={open}>
          <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle className="text-base leading-snug">
                {modalTitle ?? "Commit message"}
              </DialogTitle>
              <DialogDescription className="sr-only">Full commit message body</DialogDescription>
            </DialogHeader>
            <MarkdownContent>{trimmed}</MarkdownContent>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
