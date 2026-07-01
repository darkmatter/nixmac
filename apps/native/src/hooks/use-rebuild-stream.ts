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
