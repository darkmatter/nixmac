import { EVOLUTION_CANCELLED_MSG } from "@/lib/constants";
import { useUiState } from "@/stores/ui-state";
import { tauriAPI } from "@/ipc/api";
import { getTelemetry } from "@/lib/telemetry/instance";

/**
 * Hook for the evolution operation.
 * Handles AI-driven configuration evolution with event streaming.
 *
 * The backend handles the complete workflow (AI evolution, summary
 * generation, branch creation, database storage) and pushes all resulting
 * state through the `*_changed` cell events. The run's result data
 * (telemetry, conversational response) arrives on the terminal
 * `darwin:evolve:event` payload, handled by `viewmodel/evolution.ts`.
 */
const evolveFromManual = async () => {
  await tauriAPI.darwin.evolveFromManual();
};

const buildCheck = async () => {
  return await tauriAPI.darwin.buildCheck();
};

const refreshPromptHistory = async (prompt: string) => {
  // The backend mutation emits `prompt_history_changed`; the sync module
  // mirrors the payload into the ViewModel.
  await tauriAPI.promptHistory.add(prompt).catch(console.error);
};

const handleEvolve = async () => {
  // Get fresh state each time
  const ui = useUiState.getState();
  if (!ui.evolvePrompt.trim()) {
    return;
  }

  await refreshPromptHistory(ui.evolvePrompt.trim());

  ui.setProcessing(true, "evolve");
  ui.setGenerating(true);
  ui.setError(null);
  ui.clearLogs();
  ui.setConversationalResponse(null);
  ui.setEvolutionTelemetry(null);
  ui.appendLog(`\n> Evolving: "${ui.evolvePrompt}"\n`);

  // Track evolution start. The evolve event stream itself is folded into
  // the ViewModel by `viewmodel/evolution.ts` (and reset on the run's
  // `start` event), so no listener is needed here.
  getTelemetry().captureEvent({ name: "evolve_started" });

  try {
    // Run the unified evolution workflow. The backend updates the
    // git/evolve/change-map cells and emits the terminal `complete` event
    // (with telemetry and any conversational response) before this resolves;
    // the viewmodel sync modules mirror everything.
    await tauriAPI.darwin.evolve(ui.evolvePrompt);

    ui.setEvolvePrompt("");
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    // User-initiated cancellation isn't an error — backup still ran (and the
    // backend refreshed the change-map cell), so skip the red banner.
    const isCancelled = msg.includes(EVOLUTION_CANCELLED_MSG);

    if (isCancelled) {
      useUiState.getState().appendLog("✗ Evolution cancelled\n");
    } else {
      console.error("[useEvolve] Evolution failed:", {
        error: e,
        message: msg,
        stack: (e as Error)?.stack,
        timestamp: new Date().toISOString(),
      });
      useUiState.getState().setError(msg);
      useUiState.getState().appendLog(`✗ Error: ${msg}\n`);

      // Track evolution failure
      const stage = msg.toLowerCase().includes("build") ? "build" : msg.toLowerCase().includes("apply") ? "apply" : "agent";
      getTelemetry().captureEvent({ name: "evolve_failed", props: { stage: stage as "build" | "agent" | "apply" } });
    }
  } finally {
    useUiState.getState().setGenerating(false);
    useUiState.getState().setProcessing(false, "evolve");
  }
};

export function useEvolve() {
  return { handleEvolve, evolveFromManual, buildCheck };
}
