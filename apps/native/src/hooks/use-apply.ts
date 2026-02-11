import { useWidgetStore } from "@/stores/widget-store";
import { darwinAPI, ipcRenderer } from "@/tauri-api";
import { useCallback, useRef } from "react";
import { useGitOperations } from "./use-git-operations";

/**
 * Hook for the apply/rebuild operation.
 * Handles darwin-rebuild with streaming logs and auto-staging on success.
 * Renders inline in the main widget instead of a separate window.
 */
export function useApply() {
  const { refreshGitStatus } = useGitOperations();
  const rebuildLineIdRef = useRef(1);

  const handleApply = useCallback(async () => {
    const store = useWidgetStore.getState();
    store.setProcessing(true, "apply");
    store.startRebuild();
    rebuildLineIdRef.current = 1;

    // Listen to raw log data for console output
    const unlistenData = await ipcRenderer.on<{ chunk: string }>(
      "darwin:apply:data",
      (event) => {
        const { chunk } = event.payload;
        // Split chunk into lines and add non-empty ones
        const newLines = chunk.split("\n").filter((line) => line.trim() !== "");
        const currentStore = useWidgetStore.getState();
        for (const line of newLines) {
          currentStore.appendRawLine(line);
        }
      },
    );

    // Listen to AI-summarized log events
    const unlistenSummary = await ipcRenderer.on<{
      text: string;
      complete?: boolean;
      success?: boolean;
      error?: boolean;
      error_type?:
        | "infinite_recursion"
        | "evaluation_error"
        | "build_error"
        | "generic_error";
    }>("darwin:apply:summary", (event) => {
      const { text, complete, success, error, error_type } = event.payload;
      const currentStore = useWidgetStore.getState();

      if (complete) {
        currentStore.appendRebuildLine({
          id: rebuildLineIdRef.current++,
          text,
          type: success ? "info" : "stderr",
        });
        currentStore.setRebuildComplete(success ?? false);
      } else if (error) {
        currentStore.setRebuildError(error_type ?? "generic_error", text);
        currentStore.appendRebuildLine({
          id: rebuildLineIdRef.current++,
          text,
          type: "stderr",
        });
      } else {
        currentStore.appendRebuildLine({
          id: rebuildLineIdRef.current++,
          text,
          type: "info",
        });
      }
    });

    // Listen for rebuild end event
    const unlistenEnd = await ipcRenderer.on<{
      ok: boolean;
      code: number;
      error_type?: string;
    }>("darwin:apply:end", async (event) => {
      const currentStore = useWidgetStore.getState();
      currentStore.setRebuildComplete(event.payload.ok, event.payload.code);
      unlistenData();
      unlistenSummary();
      unlistenEnd();

      // If Full Disk Access error, force FDA permission to denied and show permissions step
      if (event.payload.error_type === "full_disk_access") {
        try {
          const permissionsState = await darwinAPI.permissions.checkAll();
          // Force FDA permission to denied AND required since we know it failed
          const updatedPermissions = permissionsState.permissions.map((p) =>
            p.id === "full-disk"
              ? { ...p, status: "denied" as const, required: true }
              : p,
          );
          const updatedState = {
            ...permissionsState,
            permissions: updatedPermissions,
            // Force allRequiredGranted to false since FDA is now required and denied
            allRequiredGranted: false,
          };
          currentStore.setPermissionsState(updatedState);
          // Clear rebuild state to allow user to see permissions step
          currentStore.clearRebuild();
        } catch (e) {
          console.error("Failed to check permissions:", e);
        }
        await refreshGitStatus({cache: true});
        currentStore.setProcessing(false);
        return;
      }

      // If successful, stage all changes and auto-dismiss after delay
      if (event.payload.ok) {
        try {
          await darwinAPI.git.stageAll();
        } catch (e) {
          console.error("Failed to stage changes:", e);
        }
        // Auto-dismiss rebuild panel after success (short delay for user feedback)
        setTimeout(() => {
          useWidgetStore.getState().clearRebuild();
        }, 2000);
      }

      await refreshGitStatus({cache: true});
      // Delay setProcessing(false) to let any pending watcher events pass
      // Watcher polls every 2.5s, so 3s ensures we catch any updates
      setTimeout(() => {
        useWidgetStore.getState().setProcessing(false);
      }, 3000);
    });

    try {
      await darwinAPI.darwin.applyStreamStart();
    } catch (e: unknown) {
      const msg = (e as Error)?.message || String(e);
      store.setRebuildError("generic_error", msg);
      store.setRebuildComplete(false);
      store.setProcessing(false);
      unlistenData();
      unlistenSummary();
      unlistenEnd();
    }
  }, [refreshGitStatus]);

  return { handleApply };
}
