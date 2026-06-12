"use client";

import {
  FILES,
  homebrewFilesFromDiff,
  replaceHomebrewPlaceholders,
} from "@/components/widget/filesystem/data";
import { UntrackedBanner } from "@/components/widget/filesystem/untracked-banner";
import { GetStartedMessage } from "@/components/widget/layout/get-started-message";
import { PromptInputSection } from "@/components/widget/promptinput/prompt-input-section";
import { useHomebrewDiff } from "@/hooks/use-homebrew-diff";
import { filesystemViewEnabled } from "@/lib/flags";
import { useWidgetStore } from "@/stores/widget-store";

export function BeginStep() {
  const setShowFilesystem = useWidgetStore((s) => s.setShowFilesystem);
  const prefsLoaded = useWidgetStore((s) => s.prefsLoaded);
  const scanHomebrewOnStartup = useWidgetStore((s) => s.scanHomebrewOnStartup);
  const shouldScan = filesystemViewEnabled && prefsLoaded && scanHomebrewOnStartup;
  const { diff, error } = useHomebrewDiff(shouldScan);
  const untrackedCandidates = diff
    ? replaceHomebrewPlaceholders(FILES.manage, homebrewFilesFromDiff(diff, error))
    : [];

  return (
    <>
      <GetStartedMessage />
      {filesystemViewEnabled && (
        <UntrackedBanner
          candidates={untrackedCandidates}
          onView={() => setShowFilesystem(true, "manage")}
        />
      )}
      <PromptInputSection />
    </>
  );
}
