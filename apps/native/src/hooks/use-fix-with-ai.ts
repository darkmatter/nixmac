import { EVOLUTION_CANCELLED_MSG } from "@/lib/constants";
import { client } from "@/lib/orpc";
import { getTelemetry } from "@/lib/telemetry/instance";
import { uiActions, useUiState, viewModelActions } from "@nixmac/state";

/**
 * "Fix with AI" for a failed build.
 *
 * Routes the build error into the existing evolve pipeline: the backend
 * `darwin.fixWithAi` procedure assembles context (the error plus a tail of the
 * on-disk rebuild transcript) and delegates to the same `run_evolve` engine, so
 * progress and the result reuse the evolve event stream
 * (`viewmodel/evolution.ts`) and the `EvolveOverlayPanel` / review-commit gate.
 *
 * This mirrors `useEvolve`'s state choreography (`use-evolve.ts`) but sources
 * the prompt from the failure instead of the user's evolve textbox.
 */
export function useFixWithAi() {
  /**
   * Start a fix run. Pass `errorLine` to target a specific log line (Phase 2
   * per-line buttons); omit it to fix the classified failure from
   * `rebuildStatus.errorMessage` (the top-level button).
   */
  const fixWithAi = async (errorLine?: string) => {
    // Reuse the evolve session, which is a single global on the backend — never
    // start a fix while an evolve/fix run is already in flight.
    if (useUiState.getState().isGenerating) {
      return;
    }

    const status = viewModelActions.getState().rebuildStatus;
    const error = (errorLine ?? status?.errorMessage ?? "").trim();
    if (!error) {
      return;
    }
    const errorType = status?.errorType ?? null;

    // Hand the screen over to the evolve progress overlay (shown while
    // `isGenerating`), and dismiss the rebuild failure panel behind it.
    uiActions.setProcessing(true, "evolve");
    uiActions.setGenerating(true);
    uiActions.setError(null);
    uiActions.clearLogs();
    uiActions.setConversationalResponse(null);
    uiActions.setEvolutionTelemetry(null);
    uiActions.setActiveStepOverride(null);
    uiActions.setRebuildPanelDismissed(true);
    uiActions.appendLog("\n> Fixing build error with AI…\n");

    const prefs = viewModelActions.getState().preferences;
    getTelemetry().captureEvent({
      name: "evolve_started",
      props: {
        trigger: "fix_build_error",
        provider: prefs?.evolveProvider ?? "default",
        has_custom_model: Boolean(prefs?.evolveModel),
      },
    });

    try {
      // Fire-and-forget: the backend updates the git/evolve/change-map cells and
      // emits the terminal `complete` event before this resolves; the viewmodel
      // sync modules mirror everything into the evolve review UI.
      await client.darwin.fixWithAi({ error, errorType });
    } catch (e: unknown) {
      const msg = (e as Error)?.message || String(e);
      const isCancelled = msg.includes(EVOLUTION_CANCELLED_MSG);

      if (isCancelled) {
        uiActions.appendLog("✗ Fix cancelled\n");
        getTelemetry().captureEvent({
          name: "evolve_cancelled",
          props: { trigger: "fix_build_error" },
        });
      } else {
        console.error("[useFixWithAi] Fix failed:", { error: e, message: msg });
        uiActions.setError(msg);
        uiActions.appendLog(`✗ Error: ${msg}\n`);
        const stage = msg.toLowerCase().includes("build") ? "build" : "agent";
        getTelemetry().captureEvent({
          name: "evolve_failed",
          props: { stage: stage as "build" | "agent" | "apply" },
        });
      }
    } finally {
      uiActions.setGenerating(false);
      uiActions.setProcessing(false, "evolve");
    }
  };

  return { fixWithAi };
}
