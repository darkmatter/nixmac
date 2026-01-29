import { darwinAPI } from "@/tauri-api";
import { useCallback } from "react";

/**
 * Hook for updating the preview indicator window.
 * The preview indicator is a small overlay that shows when there are uncommitted changes
 * and the main window is collapsed.
 */
export function usePreviewIndicator() {
  const updatePreviewIndicator = useCallback(
    async (params: {
      gitStatus: Awaited<ReturnType<typeof darwinAPI.git.status>> | null;
      summaryText: string | null;
      isLoading: boolean;
      additions?: number;
      deletions?: number;
    }) => {
      const hasChanges = params.gitStatus?.hasChanges ?? false;
      const filesChanged = params.gitStatus?.files?.length ?? 0;

      // Show preview indicator when there are uncommitted changes and main window is NOT expanded
      const shouldShow = hasChanges

      await darwinAPI.previewIndicator
        .update({
          visible: shouldShow,
          summary: params.summaryText,
          filesChanged,
          additions: params.additions,
          deletions: params.deletions,
          isLoading: params.isLoading,
        })
        .catch(() => {
          // Ignore errors - window might not exist yet
        });
    },
    []
  );

  return { updatePreviewIndicator };
}
