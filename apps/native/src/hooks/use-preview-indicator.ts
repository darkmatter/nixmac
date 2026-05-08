import { darwinAPI, type PreviewIndicatorState } from "@/tauri-api";

/**
 * Hook for updating the preview indicator window.
 * The preview indicator is a small overlay that shows when there are uncommitted changes
 * and the main window is collapsed.
 */
const updatePreviewIndicator = async (params: {
  gitStatus: Awaited<ReturnType<typeof darwinAPI.git.status>> | null;
  summaryText: string | null;
  isLoading: boolean;
  additions?: number;
  deletions?: number;
}) => {
  const hasChanges = Boolean(params.gitStatus?.diff);
  const filesChanged = params.gitStatus?.files?.length ?? 0;

  // Show preview indicator when there are changes vs main and main window is NOT expanded
  const shouldShow = hasChanges;

  const state: PreviewIndicatorState = {
    visible: shouldShow,
    summary: params.summaryText,
    filesChanged,
    additions: params.additions ?? null,
    deletions: params.deletions ?? null,
    isLoading: params.isLoading,
  };

  await darwinAPI.previewIndicator.update(state).catch(() => {
    // Ignore errors - window might not exist yet
  });
};

export function usePreviewIndicator() {
  return { updatePreviewIndicator };
}
