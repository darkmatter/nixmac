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
    const unlistenEnd = await ipcRenderer.on<{ ok: boolean; code: number }>(
      "darwin:apply:end",
      async (event) => {
        const currentStore = useWidgetStore.getState();
        currentStore.setProcessing(false);
        currentStore.setRebuildComplete(event.payload.ok, event.payload.code);
        unlistenData();
        unlistenSummary();
        unlistenEnd();

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

        await refreshGitStatus();
      },
    );

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
