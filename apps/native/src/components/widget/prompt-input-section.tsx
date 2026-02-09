"use client";

import { PromptInput } from "@/components/widget/prompt-input";
import { useWidgetStore } from "@/stores/widget-store";

export function PromptInputSection() {
  const gitStatus = useWidgetStore((s) => s.gitStatus);

  const hasChanges = (gitStatus?.files?.length ?? 0) > 0;
  const allChangesCleanlyStaged = gitStatus?.allChangesCleanlyStaged ?? false;

  const title = allChangesCleanlyStaged
    ? "Back to the drawing board!" // commit
    : hasChanges
      ? "What else can I change for you?" // evolve
      : "Lets begin to edit your system configuration."; // begin

  return (
    <div className="flex flex-col">
      <div className="flex shrink-0 items-center gap-2 border-border/50 border-b py-2">
        <img src="/outline-white.png" alt="" className="h-4 w-4 object-contain" />
        <h2 className="font-medium text-sm">
          {title}
        </h2>
      </div>

      <div className="pt-4">
        <PromptInput />
      </div>
    </div>
  );
}
