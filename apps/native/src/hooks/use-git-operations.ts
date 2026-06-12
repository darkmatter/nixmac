import { useUiState } from "@/stores/ui-state";
import { tauriAPI } from "@/ipc/api";
import { mirrorChangeMapState } from "@/viewmodel/change-map";
import { mirrorEvolveState } from "@/viewmodel/evolve";
import { mirrorGitState } from "@/viewmodel/git";
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

export const refreshGitStatus = async (options?: { cache?: boolean }) => {
  try {
    const shouldCache = options?.cache === true;
    const status = shouldCache
      ? await tauriAPI.git.statusAndCache()
      : await tauriAPI.git.status();

    mirrorGitState(status);

    return status;
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    useUiState.getState().setError(msg);
    await refreshHostsSnapshot();
    return null;
  }
};

// runs on widget mount once, to get the current git status
const getInitialStatus = async () => {
  try {
    const currentStatus = await tauriAPI.git.statusAndCache();
    mirrorGitState(currentStatus);
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    useUiState.getState().setError(msg);
    await refreshHostsSnapshot();
    return null;
  }
};

const handleCommit = async ({ message }: { message: string }) => {
  const ui = useUiState.getState();
  ui.setProcessing(true, "merge");
  ui.appendLog(`\n> Committing changes...\n`);

  try {
    const result = await tauriAPI.git.commit(message);
    useUiState.getState().appendLog("✓ Committed successfully\n");
    useUiState.getState().setError(null);
    toast.success("Committed successfully");
    mirrorChangeMapState(null);
    mirrorEvolveState(result.evolveState);
    await refreshGitStatus();
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
