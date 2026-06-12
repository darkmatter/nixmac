import { EVOLUTION_CANCELLED_MSG } from "@/lib/constants";
import { useUiState } from "@/stores/ui-state";
import { useWidgetStore } from "@/stores/widget-store";
import { EVOLVE_EVENT_CHANNEL } from "@/lib/constants";
import { tauriAPI, ipcRenderer } from "@/ipc/api";
import type { EvolveEvent } from "@/ipc/types";
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

const refreshPromptHistory = async (prompt?: string) => {
  if (prompt) {
    await tauriAPI.promptHistory.add(prompt).catch(console.error);
  }
  tauriAPI.promptHistory
    .get()
    .then((history) => useWidgetStore.getState().setPromptHistory(history))
    .catch(console.error);
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
  const store = useWidgetStore.getState();
  const ui = useUiState.getState();
  if (!ui.evolvePrompt.trim()) {
    return;
  }

  await refreshPromptHistory(ui.evolvePrompt.trim());

  ui.setProcessing(true, "evolve");
  ui.setGenerating(true);
  ui.setError(null);
  mirrorGitState(useViewModel.getState().git, false);
  store.clearEvolveEvents();
  ui.clearLogs();
  store.setConversationalResponse(null);
  store.setEvolutionTelemetry(null);
  ui.appendLog(`\n> Evolving: "${ui.evolvePrompt}"\n`);

  // Track evolution start
  getTelemetry().captureEvent({ name: "evolve_started" });
  // Set up evolve event listener
  const unlistenEvolve = await ipcRenderer.on<EvolveEvent>(EVOLVE_EVENT_CHANNEL, (event) => {
    if (event.payload) {
      useWidgetStore.getState().appendEvolveEvent(event.payload);
      if (event.payload.raw) {
        useUiState.getState().appendLog(`${event.payload.raw}\n`);
      }
    }
  });

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
      useWidgetStore.getState().setEvolutionTelemetry(telemetry);
    }

    if (isConversational) {
      useWidgetStore.getState().setConversationalResponse(result.conversationalResponse ?? null);
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
    unlistenEvolve();
  }
};

export function useEvolve() {
  return { handleEvolve, evolveFromManual, buildCheck };
}
