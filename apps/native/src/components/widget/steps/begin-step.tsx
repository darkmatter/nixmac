"use client";

import { GetStartedMessage } from "@/components/widget/get-started-message";
import { PromptInputSection } from "@/components/widget/prompt-input-section";

export function BeginStep() {
  return (
    <>
      <GetStartedMessage />
      <PromptInputSection />
    </>
  );
}
