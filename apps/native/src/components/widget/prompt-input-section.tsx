"use client";

import { ConversationalResponse } from "@/components/widget/conversational-response";
import { PromptInput } from "@/components/widget/prompt-input";
import { useCurrentStep } from "@/stores/widget-store";

export function PromptInputSection() {
  const step = useCurrentStep();

  const isCommitStep = step === "commit";
  const showTitle = step === "evolve" || isCommitStep;

  const title = isCommitStep ? "Back to the drawing board!" : "What else can I change for you?";

  return (
    <div data-testid="prompt-input-section" className="flex flex-col">
      {showTitle && (
        <div className="flex shrink-0 items-center gap-2 border-border/50 border-b py-2">
          <img src="/outline-white.png" alt="" className="h-4 w-4 object-contain" />
          <h2 className="font-medium text-sm">{title}</h2>
        </div>
      )}

      <div className="flex flex-col gap-3 pt-4">
        <ConversationalResponse />
        <PromptInput />
      </div>
    </div>
  );
}
