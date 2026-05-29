import { useWidgetStore } from "@/stores/widget-store";
import type { RebuildContext } from "@/types/ui";
import { tauriAPI, ipcRenderer } from "@/ipc/api";
import type {
  DarwinApplyDataEvent,
  DarwinApplyEndEvent,
  DarwinApplySummaryEvent,
} from "@/ipc/types";
import { useRef } from "react";
import { useGitOperations } from "./use-git-operations";

interface RebuildOptions {
  context: RebuildContext;
  /** When set, activates this nix store path instead of triggering a full rebuild. */
  storePath?: string;
  onSuccess?: () => Promise<void>;
  onFailure?: () => Promise<void>;
}

/**
 * Shared hook for triggering darwin-rebuild with streaming overlay.
 * Used by both useApply and useRollback to show rebuild progress.
 */
export function useRebuildStream() {
  const { refreshGitStatus } = useGitOperations();
  const rebuildLineIdRef = useRef(1);

  const triggerRebuild = async (options: RebuildOptions) => {
      const store = useWidgetStore.getState();
      store.startRebuild(options.context);
      rebuildLineIdRef.current = 1;

      // For store-path activation (no log summarizer), also populate summary lines.
      const unlistenData = await ipcRenderer.on<DarwinApplyDataEvent>("darwin:apply:data", (event) => {
        const { chunk } = event.payload;
        const newLines = chunk.split("\n").filter((line) => line.trim() !== "");
        const currentStore = useWidgetStore.getState();
        for (const line of newLines) {
          currentStore.appendRawLine(line);
          if (options.storePath) {
            currentStore.appendRebuildLine({ id: rebuildLineIdRef.current++, text: line, type: "info" });
          }
        }
      });

      // Listen to AI-summarized log events
      const unlistenSummary = await ipcRenderer.on<DarwinApplySummaryEvent>("darwin:apply:summary", (event) => {
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
      const unlistenEnd = await ipcRenderer.on<DarwinApplyEndEvent>("darwin:apply:end", async (event) => {
        const currentStore = useWidgetStore.getState();
        currentStore.setRebuildComplete(event.payload.ok, event.payload.code);

        if (!event.payload.ok) {
          const errorType = event.payload.error_type ?? "generic_error";
          const errorMessage = event.payload.error ?? "Rebuild failed";
          currentStore.setRebuildError(errorType, errorMessage);
        }

        unlistenData();
        unlistenSummary();
        unlistenEnd();

        // Handle Full Disk Access error
        if (event.payload.error_type === "full_disk_access") {
          try {
            const permissionsState = await tauriAPI.permissions.checkAll();
            const updatedPermissions = permissionsState.permissions.map((p) =>
              p.id === "full-disk" ? { ...p, status: "denied" as const, required: true } : p,
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
            try {
              await options.onSuccess();
            } catch (e: unknown) {
              const msg = (e as Error)?.message || String(e);
              useWidgetStore.getState().setError(msg);
            }
          }
          // Auto-dismiss rebuild panel after success (even if onSuccess failed)
          useWidgetStore.getState().clearRebuild();
          currentStore.setProcessing(false);
        } else {
          if (options?.onFailure) {
            await options.onFailure();
          }
          await refreshGitStatus({ cache: true });
          currentStore.setProcessing(false);
        }
      });

      try {
        if (options.storePath) {
          await tauriAPI.darwin.activateStorePath(options.storePath);
        } else {
          await tauriAPI.darwin.applyStreamStart();
        }
      } catch (e: unknown) {
        const msg = (e as Error)?.message || String(e);
        useWidgetStore.getState().setRebuildError("generic_error", msg);
        useWidgetStore.getState().setRebuildComplete(false);
        useWidgetStore.getState().setProcessing(false);
        unlistenData();
        unlistenSummary();
        unlistenEnd();
      }
    };

  return { triggerRebuild };
}
