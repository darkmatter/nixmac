"use client";

import { FILES } from "@/components/widget/filesystem/data";
import { UntrackedBanner } from "@/components/widget/filesystem/untracked-banner";
import { GetStartedMessage } from "@/components/widget/get-started-message";
import { PromptInputSection } from "@/components/widget/prompt-input-section";
import { filesystemViewEnabled } from "@/lib/flags";
import { useWidgetStore } from "@/stores/widget-store";

export function BeginStep() {
  const setEvolvePrompt = useWidgetStore((s) => s.setEvolvePrompt);
  const setShowFilesystem = useWidgetStore((s) => s.setShowFilesystem);

  return (
    <>
      <GetStartedMessage />
      {filesystemViewEnabled && (
        <UntrackedBanner
          candidates={FILES.manage}
          onTrackAll={(seed) => setEvolvePrompt(seed)}
          onView={() => setShowFilesystem(true)}
        />
      )}
      <PromptInputSection />
    </>
  );
}
