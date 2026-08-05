import { tauriAPI } from "@/ipc/api";
import { uiActions } from "@nixmac/state";

/**
 * Triggers for the guided Homebrew flow.
 *
 * Neither call returns an outcome: `homebrew_check` and the installer both
 * write the backend `HomebrewInstallState` cell, which reaches the UI through
 * the `homebrew` ViewModel sync module. Detection, progress and the final
 * verdict therefore have exactly one source, so the UI cannot render a success
 * the onboarding gate disagrees with.
 */

/** Probe for `brew`; the result lands in `viewModel.homebrewInstall`. */
const checkHomebrew = async (): Promise<void> => {
  try {
    await tauriAPI.homebrew.check();
  } catch {
    // The command writes the cell on success; a transport failure leaves the
    // last known value in place rather than inventing "not installed".
  }
};

/**
 * Start the guided install; progress streams into the ViewModel.
 *
 * Only a failure to *start* surfaces here (the command rejects an install that
 * is already running); once started, the run reports through the cell. The
 * backend leaves the cell untouched when it rejects, so the step stays on its
 * offer-to-install state and the user can retry.
 */
const installHomebrew = async (): Promise<void> => {
  try {
    await tauriAPI.homebrew.installStream();
  } catch (e) {
    uiActions.setError((e as Error)?.message ?? String(e));
  }
};

export function useHomebrewInstall() {
  return { checkHomebrew, installHomebrew };
}
