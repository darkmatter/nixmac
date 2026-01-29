import { useWidgetStore } from "@/stores/widget-store";
import { darwinAPI } from "@/tauri-api";
import { useCallback } from "react";
import { useGitOperations } from "./use-git-operations";

/**
 * Hook for commit and cancel operations.
 * Handles committing changes or stashing them (rollback).
 */
export function useCommit() {
  const { refreshGitStatus, gitStash } = useGitOperations();

  const handleCommit = useCallback(async () => {
    const store = useWidgetStore.getState();
    if (!store.commitMsg.trim()) {
      return;
    }

    store.setProcessing(true, "commit");
    store.appendLog(`\n> Committing: "${store.commitMsg}"\n`);

    try {
      await darwinAPI.git.commit(store.commitMsg);
      useWidgetStore.getState().appendLog("✓ Committed successfully\n");
      useWidgetStore.getState().setCommitMsg("");
      useWidgetStore.getState().setEvolvePrompt("");
      useWidgetStore.getState().clearPreview();
      await refreshGitStatus();
    } catch (e: unknown) {
      const msg = (e as Error)?.message || String(e);
      useWidgetStore.getState().setError(msg);
      useWidgetStore.getState().appendLog(`✗ Error: ${msg}\n`);
    } finally {
      useWidgetStore.getState().setProcessing(false);
    }
  }, [refreshGitStatus]);

  const handleCancel = useCallback(async () => {
    const store = useWidgetStore.getState();
    store.setProcessing(true, "cancel");
    store.appendLog("\n> Stashing changes...\n");

    try {
      await gitStash();
      useWidgetStore.getState().appendLog("✓ Changes stashed\n");
      useWidgetStore.getState().setEvolvePrompt("");
      useWidgetStore.getState().clearPreview();
      await refreshGitStatus();
    } catch (e: unknown) {
      const msg = (e as Error)?.message || String(e);
      useWidgetStore.getState().setError(msg);
      useWidgetStore.getState().appendLog(`✗ Error: ${msg}\n`);
    } finally {
      useWidgetStore.getState().setProcessing(false);
    }
  }, [refreshGitStatus, gitStash]);

  return { handleCommit, handleCancel };
}
