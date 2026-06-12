import { useUiState } from "@/stores/ui-state";
import { tauriAPI } from "@/ipc/api";
import { refreshGitSnapshot } from "@/viewmodel/git";
import { refreshHostsSnapshot } from "@/viewmodel/preferences";
import { toast } from "sonner";

/**
 * Hook for git operations.
 * Provides functions for refreshing git status changes.
 */
export const prefetchFileDiffContents = async (status: { changes: { filename: string }[] } | null) => {
  const setFileDiffContents = useUiState.getState().setFileDiffContents;
  if (!status) {
    setFileDiffContents({});
    return;
  }
  const filenames = [...new Set(status.changes.map((c) => c.filename))];
  if (filenames.length === 0) {
    setFileDiffContents({});
    return;
  }
  try {
    const result = await tauriAPI.git.fileDiffContents(filenames);
    setFileDiffContents(result ?? {});
  } catch {
    setFileDiffContents({});
  }
};

export const refreshGitStatus = async () => {
  try {
    await refreshGitSnapshot();
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    useUiState.getState().setError(msg);
    await refreshHostsSnapshot();
  }
};

// runs on widget mount once, to get the current git status
const getInitialStatus = async () => {
  await refreshGitStatus();
};

const handleCommit = async ({ message }: { message: string }) => {
  const ui = useUiState.getState();
  ui.setProcessing(true, "merge");
  ui.appendLog(`\n> Committing changes...\n`);

  try {
    // The backend clears the evolve state, refreshes the git-state cell, and
    // resets the change-map cell; the `*_changed` events mirror everything.
    await tauriAPI.git.commit(message);
    useUiState.getState().appendLog("✓ Committed successfully\n");
    useUiState.getState().setError(null);
    toast.success("Committed successfully");
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    useUiState.getState().setError(msg);
    useUiState.getState().appendLog(`✗ Error: ${msg}\n`);
  } finally {
    useUiState.getState().setProcessing(false);
  }
};

export function useGitOperations() {
  return { refreshGitStatus, getInitialStatus, handleCommit };
}
