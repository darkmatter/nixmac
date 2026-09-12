import { ipcRenderer } from "@/ipc/api";
import type { DarwinApplyEndEvent } from "@/ipc/types";
import { isProbeablePermissionRebuildError } from "@/lib/errors";
import { client } from "@/lib/orpc";
import { getTelemetry } from "@/lib/telemetry/instance";
import type { RebuildContext } from "@/types/rebuild";
import { setRebuildRawLineEcho } from "@/viewmodel/rebuild";
import { uiActions } from "@nixmac/state";
import { useGitOperations } from "./use-git-operations";

interface RebuildOptions {
  context: RebuildContext;
  /** When set, activates this nix store path instead of triggering a full rebuild. */
  storePath?: string;
  onSuccess?: () => Promise<void>;
  onFailure?: () => Promise<void>;
  /** Replays the complete operation, including any preparation and callbacks. */
  retry?: () => Promise<void>;
}

let lastRebuildRetry: (() => Promise<void>) | null = null;
const rebuildRetryListeners = new Set<() => void>();

function setRebuildRetry(retry: (() => Promise<void>) | null): void {
  if (lastRebuildRetry === retry) return;
  lastRebuildRetry = retry;
  for (const listener of rebuildRetryListeners) {
    listener();
  }
}

/** Returns whether the failed rollback can be replayed by the error panel. */
export function hasRebuildRetry(): boolean {
  return lastRebuildRetry !== null;
}

/** Clears retry state when a new operation supersedes the failed rollback. */
export function clearRebuildRetry(): void {
  setRebuildRetry(null);
}

/** Replays the last registered rollback operation, if one is available. */
export async function retryLastRebuild(): Promise<void> {
  await lastRebuildRetry?.();
}

/** Subscribes UI surfaces to changes in the available retry operation. */
export function subscribeToRebuildRetry(listener: () => void): () => void {
  rebuildRetryListeners.add(listener);
  return () => rebuildRetryListeners.delete(listener);
}

/**
 * Shared hook for triggering darwin-rebuild with streaming overlay.
 * Used by both useApply and useRollback to show rebuild progress.
 *
 * Only per-invocation orchestration lives here (context, success/failure
 * callbacks). Output folding and status mirroring are owned by
 * `viewmodel/rebuild.ts`, which also releases the processing flag and
 * re-probes permissions on permission failures when the run ends.
 */
export function useRebuildStream() {
  const { refreshGitStatus } = useGitOperations();

  const triggerRebuild = async (options: RebuildOptions) => {
    // Apply operations and rollback paths without a replay callback must not
    // reuse a callback captured by an older failed rollback.
    clearRebuildRetry();
    if (options.retry) {
      setRebuildRetry(options.retry);
    }

    uiActions.setRebuildContext(options.context);
    uiActions.setEtcClobber(null);
    // Store-path activation has no log summarizer; let the rebuild slice
    // echo raw output into the summary lines.
    setRebuildRawLineEcho(options.storePath != null);

    const unlistenEnd = await ipcRenderer.on<DarwinApplyEndEvent>(
      "darwin:apply:end",
      async (event) => {
        unlistenEnd();

        // Stash the structured /etc clobber conflicts (if any) so the error
        // overlay can render the per-file list instead of only the flat string.
        // Only `etc_clobber` failures carry this payload; clear it otherwise so
        // a later unrelated failure doesn't show stale conflicts.
        uiActions.setEtcClobber(event.payload.etc_clobber ?? null);

        // Probeable permission errors: the rebuild slice re-probes permissions;
        // dismiss the panel so the UI can route to the permissions step.
        if (isProbeablePermissionRebuildError(event.payload.error_type)) {
          uiActions.setRebuildPanelDismissed(true);
          await refreshGitStatus();
          return;
        }

        if (event.payload.ok) {
          if (options.context === "apply") {
            getTelemetry().captureEvent({ name: "apply_completed" });
          }
          if (options.onSuccess) {
            try {
              await options.onSuccess();
            } catch (e: unknown) {
              const msg = (e as Error)?.message || String(e);
              uiActions.setError(msg);
            }
          }
          // Auto-dismiss rebuild panel after success (even if onSuccess failed)
          uiActions.setRebuildPanelDismissed(true);
        } else {
          if (options.context === "apply") {
            getTelemetry().captureEvent({ name: "apply_failed" });
          }
          if (options.onFailure) {
            await options.onFailure();
          }
          await refreshGitStatus();
        }
      },
    );

    try {
      if (options.storePath) {
        await client.darwin.activateStorePath({ storePath: options.storePath });
      } else {
        await client.darwin.applyStreamStart({ hostOverride: null });
      }
    } catch (e: unknown) {
      const msg = (e as Error)?.message || String(e);
      uiActions.setError(msg);
      uiActions.setProcessing(false);
      unlistenEnd();
    }
  };

  return { triggerRebuild };
}
