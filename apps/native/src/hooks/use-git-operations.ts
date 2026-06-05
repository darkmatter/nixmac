import { loadHosts } from "@/hooks/use-widget-initialization";
import { useWidgetStore } from "@/stores/widget-store";
import { tauriAPI } from "@/ipc/api";
import { mirrorChangeMapState } from "@/viewmodel/change-map";
import { mirrorEvolveState } from "@/viewmodel/evolve";
import { mirrorGitState } from "@/viewmodel/git";
import { toast } from "sonner";

let fileDiffContentsRequestId = 0;

/**
 * Hook for git operations.
 * Provides functions for refreshing git status changes.
 */
export const prefetchFileDiffContents = async (status: { changes: { filename: string }[] } | null) => {
  const requestId = ++fileDiffContentsRequestId;
  const setFileDiffContents = useWidgetStore.getState().setFileDiffContents;
  if (!status) {
    setFileDiffContents({});
    return;
  }
  const filenames = [...new Set(status.changes.map((c) => c.filename))];
  if (filenames.length === 0) {
    setFileDiffContents({});
    return;
  }
  setFileDiffContents({});
  try {
    const result = await tauriAPI.git.fileDiffContents(filenames);
    if (requestId === fileDiffContentsRequestId) {
      setFileDiffContents(result ?? {});
    }
  } catch {
    if (requestId === fileDiffContentsRequestId) {
      setFileDiffContents(Object.fromEntries(filenames.map((filename) => [filename, null])));
    }
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
    useWidgetStore.getState().setError(msg);
    if (msg.includes("is not a git repository")) {
      useWidgetStore.getState().setHosts([]);
    } else {
      await loadHosts();
    }
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
    useWidgetStore.getState().setError(msg);
    if (msg.includes("is not a git repository")) {
      useWidgetStore.getState().setHosts([]);
    } else {
      await loadHosts();
    }
    return null;
  }
};

const handleCommit = async ({ message }: { message: string }) => {
  const store = useWidgetStore.getState();
  store.setProcessing(true, "merge");
  store.appendLog(`\n> Committing changes...\n`);

  try {
    const result = await tauriAPI.git.commit(message);
    useWidgetStore.getState().appendLog("✓ Committed successfully\n");
    useWidgetStore.getState().setError(null);
    toast.success("Committed successfully");
    mirrorChangeMapState(null);
    mirrorEvolveState(result.evolveState);
    await refreshGitStatus();
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    useWidgetStore.getState().setError(msg);
    useWidgetStore.getState().appendLog(`✗ Error: ${msg}\n`);
  } finally {
    useWidgetStore.getState().setProcessing(false);
  }
};

export function useGitOperations() {
  return { refreshGitStatus, getInitialStatus, handleCommit };
}
