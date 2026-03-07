import { useWidgetStore } from "@/stores/widget-store";
import { darwinAPI } from "@/tauri-api";
import { useCallback } from "react";
import { useRebuildStream } from "./use-rebuild-stream";

/**
 * Hook for discarding changes and returning to main.
 *
 * Logic:
 * 1. Single rollbackErase call: restore changes, checkout main, optionally purge + delete branch
 * 2. Update store with returned git status and summary
 * 3. If branch had a built commit, rebuild to activate main's config
 */
export function useRollback() {
  const { triggerRebuild } = useRebuildStream();

  const handleRollback = useCallback(
    async (keepBranch = false) => {
      const store = useWidgetStore.getState();
      const evolveBranchHadBuiltCommit = store.gitStatus?.branchHasBuiltCommit;

      store.setProcessing(true, "cancel");
      store.appendLog("\n> Discarding changes...\n");

      try {
        const result = await darwinAPI.darwin.rollbackErase(keepBranch);

        store.setGitStatus(result.gitStatus);
        if (result.summary) {
          store.setSummary(result.summary);
        }
        store.setEvolvePrompt("");
        store.clearPreview();
        store.appendLog("✓ Changes discarded\n");
        if (evolveBranchHadBuiltCommit) {
          store.appendLog("> Rebuilding to activate main configuration...\n");
          await triggerRebuild({ context: "rollback" });
          // Note: processing state cleared by rebuild stream
        } else {
          store.setProcessing(false);
        }
      } catch (e: unknown) {
        const msg = (e as Error)?.message || String(e);
        useWidgetStore.getState().setError(msg);
        useWidgetStore.getState().appendLog(`✗ Error: ${msg}\n`);
        useWidgetStore.getState().setProcessing(false);
      }
    },
    [triggerRebuild],
  );

  return { handleRollback };
}
