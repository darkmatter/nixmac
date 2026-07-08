import type { ViewModelState } from "@nixmac/state";

type ActiveConfigInputs = Pick<ViewModelState, "onboardingState" | "preferences">;

/**
 * The active configuration directory: the selection staged by an uncommitted
 * onboarding flow wins over the committed preference — mirroring the
 * backend's staged-first resolution in `store::get_config_dir_if_set`. After
 * the first apply commits the staged selection, only the preference is set.
 */
export function activeConfigDir(s: ActiveConfigInputs): string {
  return s.onboardingState?.stagedConfigDir ?? s.preferences?.configDir ?? "";
}

/** The active host attribute; staged-first like {@link activeConfigDir}. */
export function activeHostAttr(s: ActiveConfigInputs): string {
  return s.onboardingState?.stagedHostAttr ?? s.preferences?.hostAttr ?? "";
}
