import { EVOLUTION_CANCELLED_MSG } from "@/lib/constants";
import { useWidgetStore } from "@/stores/widget-store";
import { EVOLVE_EVENT_CHANNEL } from "@/lib/constants";
import { tauriAPI, ipcRenderer } from "@/ipc/api";
import type { EvolveEvent } from "@/ipc/types";
import { formatDurationMs } from "@/lib/utils";

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
  const { setChangeMap, setSummaryAvailable } = useWidgetStore.getState();
  try {
    const map = await tauriAPI.summarizedChanges.findChangeMap();
    if (map) {
      setChangeMap(map);
      setSummaryAvailable(map.groups.length > 0 || map.singles.length > 0);
    }
  } catch (e) {
    console.error("[SemanticChangeMap] error", e);
  }
};

const handleEvolve = async () => {
  // Get fresh state each time
  const store = useWidgetStore.getState();
  if (!store.evolvePrompt.trim()) {
    return;
  }

  await refreshPromptHistory(store.evolvePrompt.trim());

  store.setProcessing(true, "evolve");
  store.setGenerating(true);
  store.setError(null);
  store.setExternalBuildDetected(false);
  store.clearEvolveEvents();
  store.clearLogs();
  store.clearPreview();
  store.setConversationalResponse(null);
  store.setEvolutionTelemetry(null);
  store.appendLog(`\n> Evolving: "${store.evolvePrompt}"\n`);

  // Set up evolve event listener
  const unlistenEvolve = await ipcRenderer.on<EvolveEvent>(EVOLVE_EVENT_CHANNEL, (event) => {
    if (event.payload) {
      useWidgetStore.getState().appendEvolveEvent(event.payload);
      if (event.payload.raw) {
        useWidgetStore.getState().appendLog(`${event.payload.raw}\n`);
      }
    }
  });

  try {
    // Run the unified evolution workflow
    // Backend handles: AI + summary + branch + commit + DB
    const result = await tauriAPI.darwin.evolve(store.evolvePrompt);
    const isConversational = result?.telemetry?.state === "conversational";

    const telemetry = result?.telemetry;
    const completionMsg = telemetry
      ? `✓ Evolution complete in ${formatDurationMs(telemetry.durationMs)} and ${telemetry.iterations} iteration${telemetry.iterations === 1 ? "" : "s"}\n`
      : "✓ Evolution complete\n";
    useWidgetStore.getState().appendLog(completionMsg);
    if (telemetry) {
      useWidgetStore.getState().setEvolutionTelemetry(telemetry);
    }

    if (isConversational) {
      useWidgetStore.getState().setConversationalResponse(result.conversationalResponse ?? null);
    } else {
      store.setSummaryAvailable(true);
    }
    if (result?.gitStatus) {
      useWidgetStore.getState().setGitStatus(result.gitStatus);
    }
    if (result?.evolveState) {
      useWidgetStore.getState().setEvolveState(result.evolveState);
    }
    if (!isConversational && result?.changeMap) {
      useWidgetStore.getState().setChangeMap(result.changeMap);
    }

    store.setEvolvePrompt("");
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    // User-initiated cancellation isn't an error — backup still ran, so refresh
    // the change map but skip the red banner.
    const isCancelled = msg.includes(EVOLUTION_CANCELLED_MSG);

    if (isCancelled) {
      useWidgetStore.getState().appendLog("✗ Evolution cancelled\n");
    } else {
      console.error("[useEvolve] Evolution failed:", {
        error: e,
        message: msg,
        stack: (e as Error)?.stack,
        timestamp: new Date().toISOString(),
      });
      useWidgetStore.getState().setError(msg);
      useWidgetStore.getState().appendLog(`✗ Error: ${msg}\n`);
    }
    await findChangeMap();
  } finally {
    useWidgetStore.getState().setGenerating(false);
    useWidgetStore.getState().setProcessing(false, "evolve");
    unlistenEvolve();
  }
};

export function useEvolve() {
  return { handleEvolve, evolveFromManual, buildCheck };
}
