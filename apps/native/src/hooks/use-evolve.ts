import { EVOLUTION_CANCELLED_MSG } from "@/lib/constants";
import { useUiState } from "@/stores/ui-state";
import { tauriAPI } from "@/ipc/api";
import { formatDurationMs } from "@/lib/utils";
import { useViewModel } from "@/stores/view-model";
import { mirrorChangeMapState } from "@/viewmodel/change-map";
import { mirrorEvolveState } from "@/viewmodel/evolve";
import { mirrorGitState } from "@/viewmodel/git";
import { toast } from "sonner";
import { getTelemetry } from "@/lib/telemetry/instance";

/**
 * Hook for the evolution operation.
 * Handles AI-driven configuration evolution with event streaming.
 *
 * The backend now handles the complete workflow:
 * - AI evolution
 * - Summary generation
 * - Branch creation (if on main)
 * - Committing changes
 * - Database storage
 * - Returns summary and final git status
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

const findChangeMap = async (): Promise<void> => {
  try {
    const map = await tauriAPI.summarizedChanges.findChangeMap();
    if (map) {
      mirrorChangeMapState(map);
    }
  } catch (e) {
    console.error("[SemanticChangeMap] error", e);
  }
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
  mirrorGitState(useViewModel.getState().git, false);
  ui.clearLogs();
  ui.setConversationalResponse(null);
  ui.setEvolutionTelemetry(null);
  ui.appendLog(`\n> Evolving: "${ui.evolvePrompt}"\n`);

  // Track evolution start. The evolve event stream itself is folded into
  // the ViewModel by `viewmodel/evolution.ts` (and reset on the run's
  // `start` event), so no listener is needed here.
  getTelemetry().captureEvent({ name: "evolve_started" });

  try {
    // Run the unified evolution workflow
    // Backend handles: AI + summary + branch + commit + DB
    const result = await tauriAPI.darwin.evolve(ui.evolvePrompt);
    const isConversational = result?.telemetry?.state === "conversational";
    const isLimitReached = result?.telemetry?.state === "limitReached";

    const telemetry = result?.telemetry;
    const iterationSuffix = telemetry
      ? ` in ${formatDurationMs(telemetry.durationMs)} and ${telemetry.iterations} iteration${telemetry.iterations === 1 ? "" : "s"}`
      : "";
    const completionMsg = isLimitReached
      ? `⏸ Evolution stopped (safety limit reached)${iterationSuffix}\n`
      : `✓ Evolution complete${iterationSuffix}\n`;
    useUiState.getState().appendLog(completionMsg);
    if (isLimitReached) {
      toast.info(completionMsg);
    } else {
      toast.success(completionMsg);
    }
    if (telemetry) {
      useUiState.getState().setEvolutionTelemetry(telemetry);
    }

    if (isConversational) {
      useUiState.getState().setConversationalResponse(result.conversationalResponse ?? null);
    }
    if (result?.gitStatus) {
      mirrorGitState(result.gitStatus);
    }
    if (result?.evolveState) {
      mirrorEvolveState(result.evolveState);
    }
    if (!isConversational && result?.changeMap) {
      mirrorChangeMapState(result.changeMap);
    }

    ui.setEvolvePrompt("");

    // Track successful evolution
    if (result?.evolveState) {
      const step = result.evolveState.step;
      getTelemetry().captureEvent({ name: "evolve_completed", props: { step } });
    }
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    // User-initiated cancellation isn't an error — backup still ran, so refresh
    // the change map but skip the red banner.
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
    await findChangeMap();
  } finally {
    useUiState.getState().setGenerating(false);
    useUiState.getState().setProcessing(false, "evolve");
  }
};

export function useEvolve() {
  return { handleEvolve, evolveFromManual, buildCheck };
}
