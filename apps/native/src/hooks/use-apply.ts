import { useWidgetStore, type RebuildErrorType } from "@/stores/widget-store";
import { darwinAPI, ipcRenderer } from "@/tauri-api";
import { useCallback, useRef } from "react";
import { useGitOperations } from "@/hooks/use-git-operations";
import { useSummary } from "@/hooks/use-summary";

/**
 * Hook for the apply/rebuild operation.
 * Handles darwin-rebuild with streaming logs and auto-staging on success.
 * Renders inline in the main widget instead of a separate window.
 */
export function useApply() {
  const { refreshGitStatus } = useGitOperations();
  const { fetchSummary } = useSummary();
  const rebuildLineIdRef = useRef(1);

  const handleApply = useCallback(async () => {
    const store = useWidgetStore.getState();
    store.setProcessing(true, "apply");
    store.startRebuild();
    rebuildLineIdRef.current = 1;

    const unlistenData = await ipcRenderer.on<{ chunk: string }>(
      "darwin:apply:data",
      (event) => {
        const { chunk } = event.payload;
        const newLines = chunk.split("\n").filter((line) => line.trim() !== "");
        const currentStore = useWidgetStore.getState();
        for (const line of newLines) {
          currentStore.appendRawLine(line);
        }
      },
    );

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

    const unlistenEnd = await ipcRenderer.on<{
      ok: boolean;
      code: number;
      error_type?: string;
      error?: string;
    }>("darwin:apply:end", async (event) => {
      const currentStore = useWidgetStore.getState();
      currentStore.setRebuildComplete(event.payload.ok, event.payload.code);

      if (!event.payload.ok && event.payload.error) {
        const errorType = (event.payload.error_type ?? "build_error") as RebuildErrorType;
        currentStore.setRebuildError(errorType, event.payload.error);
      }

      unlistenData();
      unlistenSummary();
      unlistenEnd();

      if (event.payload.error_type === "full_disk_access") {
        try {
          const permissionsState = await darwinAPI.permissions.checkAll();
          const updatedPermissions = permissionsState.permissions.map((p) =>
            p.id === "full-disk"
              ? { ...p, status: "denied" as const, required: true }
              : p,
          );
          currentStore.setPermissionsState({
            ...permissionsState,
            permissions: updatedPermissions,
            allRequiredGranted: false,
          });
          currentStore.clearRebuild();
        } catch (e) {
          console.error("Failed to check permissions:", e);
        }
        await refreshGitStatus({cache: true});
        currentStore.setProcessing(false);
        return;
      }

      if (event.payload.ok) {
        try {
          await darwinAPI.git.stageAll();
        } catch (e) {
          console.error("Failed to stage changes:", e);
        }
        setTimeout(() => {
          useWidgetStore.getState().clearRebuild();
        }, 2000);
      }

      await refreshGitStatus({cache: true});
      await fetchSummary();
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
      console.error("applyStreamStart failed:", msg);
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
