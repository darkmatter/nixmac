"use client";

import { GetStartedMessage } from "@/components/widget/layout/get-started-message";
import { PromptInputSection } from "@/components/widget/promptinput/prompt-input-section";

export function BeginStep() {
  return (
    <>
      <GetStartedMessage />
      <PromptInputSection />
    </>
  );
}
