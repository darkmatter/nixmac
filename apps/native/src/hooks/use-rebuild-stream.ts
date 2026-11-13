import { ipcRenderer } from "@/ipc/api";
import type { DarwinApplyEndEvent } from "@/ipc/types";
import { isProbeablePermissionRebuildError } from "@/lib/errors";
import { client } from "@/lib/orpc";
import { getTelemetry } from "@/lib/telemetry/instance";
import type { RebuildContext } from "@/types/rebuild";
import { setRebuildRawLineEcho } from "@/viewmodel/rebuild";
import { uiActions, uiStore } from "@nixmac/state";
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

/** Returns whether the failed rollback can be replayed by the error panel. */
export function hasRebuildRetry(): boolean {
  return uiStore.getState().rebuildRetry !== null;
}

/**
 * Returns how many times a retry has been registered since the last clear.
 * A fresh retry is registered after every failed attempt, so values above
 * one signal repeated consecutive failures rather than a transient hiccup.
 */
export function getRebuildRetryAttempts(): number {
  return uiStore.getState().rebuildRetryAttempts;
}

/** Clears retry state when a new operation supersedes the failed rollback. */
export function clearRebuildRetry(): void {
  uiActions.setRebuildRetry(null);
}

/** Replays the last registered rollback operation, if one is available. */
export async function retryLastRebuild(): Promise<void> {
  await uiStore.getState().rebuildRetry?.();
}

// Monotonic sequence per triggerRebuild call so a run can tell whether a
// newer operation superseded it while its failure cleanup was in flight.
let rebuildRunSeq = 0;

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
    const runSeq = ++rebuildRunSeq;
    // Apply operations and rollback paths without a replay callback must not
    // reuse a callback captured by an older failed rollback.
    clearRebuildRetry();
    if (options.retry) {
      uiActions.setRebuildRetry(options.retry);
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
          uiActions.setRebuildRetryAttempts(0);
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
          // Retryable operations (rollback/restore) count consecutive failures
          // so the error panel can flag likely-permanent failures; any other
          // failed run supersedes the chain and resets the count.
          uiActions.setRebuildRetryAttempts(
            options.retry ? uiStore.getState().rebuildRetryAttempts + 1 : 0,
          );
          if (options.context === "apply") {
            getTelemetry().captureEvent({ name: "apply_failed" });
          }
          if (options.onFailure) {
            // The panel enables retry as soon as the backend reports the
            // failure, so lift the callback while cleanup is in flight and
            // only restore it after the cleanup of *this* run resolved —
            // a superseding operation must not get clobbered, and a failed
            // cleanup must not re-arm a retry against an uncleaned state.
            if (options.retry) {
              uiActions.setRebuildRetry(null);
            }
            let cleanupOk = true;
            try {
              await options.onFailure();
            } catch (e: unknown) {
              cleanupOk = false;
              const msg = (e as Error)?.message || String(e);
              uiActions.setError(msg);
            }
            if (cleanupOk && options.retry && runSeq === rebuildRunSeq) {
              uiActions.setRebuildRetry(options.retry);
            }
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
