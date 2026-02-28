"use client";

import { PromptInput } from "@/components/widget/prompt-input";
import { useWidgetStore } from "@/stores/widget-store";

export function PromptInputSection() {
  const gitStatus = useWidgetStore((s) => s.gitStatus);

  const hasChanges = Boolean(gitStatus?.diff);
  const isCommitStep = !(gitStatus!.isMainBranch) && gitStatus!.headIsBuilt;
  const showTitle = hasChanges || isCommitStep;

  const title = isCommitStep
    ? "Back to the drawing board!"
    : "What else can I change for you?";

  return (
    <div className="flex flex-col">
      {showTitle && (
        <div className="flex shrink-0 items-center gap-2 border-border/50 border-b py-2">
          <img src="/outline-white.png" alt="" className="h-4 w-4 object-contain" />
          <h2 className="font-medium text-sm">
            {title}
          </h2>
        </div>
      )}

      <div className="pt-4">
        <PromptInput />
      </div>
    </div>
  );
}
