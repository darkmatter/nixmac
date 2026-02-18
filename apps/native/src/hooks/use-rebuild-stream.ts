import { useWidgetStore } from "@/stores/widget-store";
import { darwinAPI, ipcRenderer } from "@/tauri-api";
import { useCallback, useRef } from "react";
import { useGitOperations } from "./use-git-operations";

interface RebuildOptions {
  /** Called after successful rebuild (before auto-dismiss) */
  onSuccess?: () => Promise<void>;
}

/**
 * Shared hook for triggering darwin-rebuild with streaming overlay.
 * Used by both useApply and useRollback to show rebuild progress.
 */
export function useRebuildStream() {
  const { refreshGitStatus } = useGitOperations();
  const rebuildLineIdRef = useRef(1);

  const triggerRebuild = useCallback(
    async (options?: RebuildOptions) => {
      const store = useWidgetStore.getState();
      store.startRebuild();
      rebuildLineIdRef.current = 1;

      // Listen to raw log data for console output
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

      // Listen to AI-summarized log events
      const unlistenSummary = await ipcRenderer.on<{
        text: string;
        complete?: boolean;
        success?: boolean;
        error?: boolean;
        error_type?: "infinite_recursion" | "evaluation_error" | "build_error" | "generic_error";
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

        // Handle Full Disk Access error
        if (event.payload.error_type === "full_disk_access") {
          try {
            const permissionsState = await darwinAPI.permissions.checkAll();
            const updatedPermissions = permissionsState.permissions.map((p) =>
              p.id === "full-disk"
                ? { ...p, status: "denied" as const, required: true }
                : p,
            );
            const updatedState = {
              ...permissionsState,
              permissions: updatedPermissions,
              allRequiredGranted: false,
            };
            currentStore.setPermissionsState(updatedState);
            currentStore.clearRebuild();
          } catch (e) {
            console.error("Failed to check permissions:", e);
          }
          await refreshGitStatus({ cache: true });
          currentStore.setProcessing(false);
          return;
        }

        // Handle success
        if (event.payload.ok) {
          if (options?.onSuccess) {
            await options.onSuccess();
          }
          // Auto-dismiss rebuild panel after success
          setTimeout(() => {
            useWidgetStore.getState().clearRebuild();
          }, 2000);
        }

        await refreshGitStatus({ cache: true });
        // Delay setProcessing to let watcher events settle
        setTimeout(() => {
          useWidgetStore.getState().setProcessing(false);
        }, 3000);
      });

      try {
        await darwinAPI.darwin.applyStreamStart();
      } catch (e: unknown) {
        const msg = (e as Error)?.message || String(e);
        useWidgetStore.getState().setRebuildError("generic_error", msg);
        useWidgetStore.getState().setRebuildComplete(false);
        useWidgetStore.getState().setProcessing(false);
        unlistenData();
        unlistenSummary();
        unlistenEnd();
      }
    },
    [refreshGitStatus],
  );

  return { triggerRebuild };
}
