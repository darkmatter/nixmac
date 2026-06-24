"use client";

import {
  FILES,
  homebrewFilesFromDiff,
  launchdItemsFileFromScan,
  replaceHomebrewPlaceholders,
  replaceLaunchdPlaceholder,
  replaceSystemDefaultsPlaceholder,
  systemDefaultsFileFromScan,
} from "@/components/widget/filesystem/data";
import { UntrackedBanner } from "@/components/widget/filesystem/untracked-banner";
import { GetStartedMessage } from "@/components/widget/layout/get-started-message";
import { PromptInputSection } from "@/components/widget/promptinput/prompt-input-section";
import { useHomebrewDiff } from "@/hooks/use-homebrew-diff";
import { useLaunchdItems } from "@/hooks/use-launchd-items";
import { useSystemDefaultsScan } from "@/hooks/use-system-defaults-scan";
import { filesystemViewEnabled } from "@/lib/flags";
import { uiActions, useViewModel } from "@nixmac/state";

export function BeginStep() {
    const prefsLoaded = useViewModel((s) => s.preferences !== null);
  const scanHomebrewOnStartup = useViewModel((s) => s.preferences?.scanHomebrewOnStartup ?? false);
  const shouldScan = filesystemViewEnabled && prefsLoaded && scanHomebrewOnStartup;
  const { diff, error } = useHomebrewDiff(shouldScan);
  const { scan: systemDefaultsScan, error: systemDefaultsError } =
    useSystemDefaultsScan(shouldScan);
  const { items: launchdItems, error: launchdError } = useLaunchdItems(shouldScan);
  const untrackedCandidates =
    diff || systemDefaultsScan || launchdItems || error || systemDefaultsError || launchdError
      ? replaceLaunchdPlaceholder(
          replaceSystemDefaultsPlaceholder(
            replaceHomebrewPlaceholders(FILES.manage, homebrewFilesFromDiff(diff, error)),
            systemDefaultsFileFromScan(systemDefaultsScan, systemDefaultsError),
          ),
          launchdItemsFileFromScan(launchdItems, launchdError),
        )
      : [];

  return (
    <>
      <GetStartedMessage />
      {filesystemViewEnabled && (
        <UntrackedBanner
          candidates={untrackedCandidates}
          onView={() => uiActions.setShowFilesystem(true, "manage")}
        />
      )}
      <PromptInputSection />
    </>
  );
}
