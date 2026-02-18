import { slugify } from "@/components/widget/utils";
import { useWidgetStore } from "@/stores/widget-store";
import { darwinAPI } from "@/tauri-api";
import { useCallback } from "react";
import { useSummary } from "@/hooks/use-summary";
import { useRebuildStream } from "@/hooks/use-rebuild-stream";

/**
 * Hook for the apply/rebuild operation.
 * Handles darwin-rebuild with streaming logs and auto-staging on success.
 * Renders inline in the main widget instead of a separate window.
 */
export function useApply() {
  const { fetchSummary } = useSummary();
  const { triggerRebuild } = useRebuildStream();

  const handleApply = useCallback(async () => {
    const store = useWidgetStore.getState();
    store.setProcessing(true, "apply");

    await triggerRebuild({
      onSuccess: async () => {
        try {
          const currentStore = useWidgetStore.getState();
          const gitStatus = currentStore.gitStatus;

          // If on main with manual changes, create branch and commit first
          if (gitStatus?.isMainBranch ?? true) {
            // Fetch summary to get a commit message
            await fetchSummary();
            const summary = useWidgetStore.getState().summary;
            const commitMessage = summary?.commitMessage
              ? `${summary.commitMessage} (manual changes)`
              : "chore: manual configuration changes";

            // Create a branch for manual changes using slugified commit message
            const branchSlug = slugify(commitMessage);
            const branchName = `nixmac-evolve/${branchSlug || "manual-changes"}`;
            await darwinAPI.git.checkoutNewBranch(branchName);

            // Commit the changes
            await darwinAPI.git.commit(commitMessage);
          }

          // Tag HEAD as built
          await darwinAPI.git.tagAsBuilt();
        } catch (e) {
          console.error("Failed to complete build workflow:", e);
        }

        // Refresh summary after successful build
        await fetchSummary();
      },
    });
  }, [triggerRebuild, fetchSummary]);

  return { handleApply };
}
