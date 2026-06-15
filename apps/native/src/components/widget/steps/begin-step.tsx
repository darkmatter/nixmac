"use client";

import {
  FILES,
  homebrewFilesFromDiff,
  replaceHomebrewPlaceholders,
  replaceSystemDefaultsPlaceholder,
  systemDefaultsFileFromScan,
} from "@/components/widget/filesystem/data";
import { UntrackedBanner } from "@/components/widget/filesystem/untracked-banner";
import { GetStartedMessage } from "@/components/widget/layout/get-started-message";
import { PromptInputSection } from "@/components/widget/promptinput/prompt-input-section";
import { useHomebrewDiff } from "@/hooks/use-homebrew-diff";
import { useSystemDefaultsScan } from "@/hooks/use-system-defaults-scan";
import { filesystemViewEnabled } from "@/lib/flags";
import { useWidgetStore } from "@/stores/widget-store";

export function BeginStep() {
  const setShowFilesystem = useWidgetStore((s) => s.setShowFilesystem);
  const prefsLoaded = useWidgetStore((s) => s.prefsLoaded);
  const scanHomebrewOnStartup = useWidgetStore((s) => s.scanHomebrewOnStartup);
  const shouldScan = filesystemViewEnabled && prefsLoaded && scanHomebrewOnStartup;
  const { diff, error } = useHomebrewDiff(shouldScan);
  const { scan: systemDefaultsScan, error: systemDefaultsError } =
    useSystemDefaultsScan(shouldScan);
  const untrackedCandidates =
    diff || systemDefaultsScan || error || systemDefaultsError
      ? replaceSystemDefaultsPlaceholder(
          replaceHomebrewPlaceholders(FILES.manage, homebrewFilesFromDiff(diff, error)),
          systemDefaultsFileFromScan(systemDefaultsScan, systemDefaultsError),
        )
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
