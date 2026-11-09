import { client } from "@/lib/orpc";
import { uiActions, viewModelActions } from "@nixmac/state";

/**
 * Hook for fetching and managing the AI-generated summary of changes.
 * The backend commands record the recomputed map in the change-map cell;
 * `change_map_changed` mirrors it into the ViewModel.
 */
const findChangeMap = async (): Promise<void> => {
  try {
    await client.summarizedChanges.findChangeMap();
  } catch (e) {
    console.error("[SemanticChangeMap] error", e);
  }
};

let commitMessageGeneration: Promise<void> | null = null;
let commitMessageEpoch = 0;

/**
 * Generate (or join) the commit-message inference for the current diff.
 *
 * Single-flight: concurrent callers — the apply-time prefetch, the save
 * panel's mount effect, the Regenerate button — join one in-flight IPC
 * call instead of racing duplicate inference over the same diff. Only a
 * `force` start (the diff is final at Apply) detaches and supersedes.
 */
const generateCommitMessage = async (options?: {
  clear?: boolean;
  force?: boolean;
}) => {
  const clear = options?.clear ?? true;
  const force = options?.force ?? false;
  if (!force && commitMessageGeneration) {
    return commitMessageGeneration;
  }
  // Invalidate any in-flight generation: its resolve must not resurrect a
  // suggestion for a diff the user has already moved past.
  const epoch = ++commitMessageEpoch;
  if (clear) {
    uiActions.setCommitMessageSuggestion(null);
  }
  const run = (async () => {
    try {
      const message = await client.summarizedChanges.generateCommitMessage();
      if (epoch === commitMessageEpoch) {
        uiActions.setCommitMessageSuggestion(message);
      }
    } catch {
      // Keep existing on error — user can type manually
    } finally {
      // A superseded flight (force restart, clear) must not detach the
      // current handle — only the flight that still owns the epoch may.
      if (epoch === commitMessageEpoch) {
        commitMessageGeneration = null;
      }
    }
  })();
  commitMessageGeneration = run;
  return run;
};

/**
 * Clear the suggestion and invalidate any in-flight generation, so a stale
 * resolve cannot repopulate the field for a diff that no longer exists.
 * Callers that reset UI state between diffs (evolve, commit) must use this
 * instead of `uiActions.setCommitMessageSuggestion(null)`.
 */
export const clearCommitMessageSuggestion = () => {
  commitMessageEpoch += 1;
  commitMessageGeneration = null;
  uiActions.setCommitMessageSuggestion(null);
};

const generateCurrentSummary = async () => {
  uiActions.setSummarizing(true);
  try {
    await client.summarizedChanges.summarizeCurrent();
  } finally {
    uiActions.setSummarizing(false);
  }
};

const summarizeOnFocus = () => {
  if (viewModelActions.getState().preferences?.autoSummarizeOnFocus) {
    generateCurrentSummary();
  }
};

export function useSummary() {
  return {
    clearCommitMessageSuggestion,
    findChangeMap,
    generateCommitMessage,
    generateCurrentSummary,
    summarizeOnFocus,
  };
}
