import {
  EVOLVE_PROMPT_SUGGESTIONS_FLAG,
  PROMPT_SUGGESTIONS_VARIANTS,
} from "@/components/widget/promptinput/prompt-suggestions-variant";
import {
  CLI_PROVIDERS_FLAG,
  CLI_PROVIDERS_VARIANTS,
} from "@/lib/providers/cli-providers-flag";

/** One selectable override value for a flag, plus its human-facing label. */
type FlagOverrideOption = { value: string; label: string };

/**
 * A multivariate PostHog feature flag a developer can override locally from the
 * Developer settings tab.
 *
 * The override is persisted as a string in
 * `GlobalPreferences.featureFlagOverrides` and read back by `useFeatureFlag`
 * verbatim, so only string-valued (multivariate) flags belong here — list each
 * variant key in `options`. Boolean flags are intentionally unsupported: a
 * `"false"` string would read back truthy at the call site.
 */
type OverridableFlag = {
  /** PostHog flag key; also the key under `featureFlagOverrides`. */
  key: string;
  /** Optional human label; defaults to the raw key when omitted. */
  label?: string;
  /** Override values offered alongside the "PostHog default" reset. */
  options: readonly FlagOverrideOption[];
};

/**
 * Registry of developer-overridable feature flags. Add an entry here to expose
 * a new flag in the Developer tab — the UI renders generically over this list,
 * with no per-flag code.
 */
export const OVERRIDABLE_FLAGS: readonly OverridableFlag[] = [
  {
    key: EVOLVE_PROMPT_SUGGESTIONS_FLAG,
    options: PROMPT_SUGGESTIONS_VARIANTS.map((variant) => ({
      value: variant,
      label: variant,
    })),
  },
  {
    key: CLI_PROVIDERS_FLAG,
    options: CLI_PROVIDERS_VARIANTS.map((variant) => ({
      value: variant,
      label: variant,
    })),
  },
];
