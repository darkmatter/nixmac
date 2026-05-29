"use client";

import { FILES } from "@/components/widget/filesystem/data";
import { UntrackedBanner } from "@/components/widget/filesystem/untracked-banner";
import { GetStartedMessage } from "@/components/widget/layout/get-started-message";
import { PromptInputSection } from "@/components/widget/promptinput/prompt-input-section";
import { filesystemViewEnabled } from "@/lib/flags";
import { useUiStore } from "@/stores/ui-store";

export function BeginStep() {
  const setEvolvePrompt = useUiStore((s) => s.setEvolvePrompt);
  const setShowFilesystem = useUiStore((s) => s.setShowFilesystem);

  return (
    <>
      <GetStartedMessage />
      {filesystemViewEnabled && (
        <UntrackedBanner
          candidates={FILES.manage}
          onTrackAll={(seed) => setEvolvePrompt(seed)}
          onView={() => setShowFilesystem(true, "manage")}
        />
      )}
      <PromptInputSection />
    </>
  );
}
