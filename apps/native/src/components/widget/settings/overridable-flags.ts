import {
  EVOLVE_PROMPT_SUGGESTIONS_FLAG,
  PROMPT_SUGGESTIONS_VARIANTS,
} from "@/components/widget/promptinput/prompt-suggestions-variant";
import {
  CLI_PROVIDERS_FLAG,
  CLI_PROVIDERS_VARIANTS,
} from "@/lib/providers/cli-providers-flag";
import {
  MENU_BAR_POPOVER_FLAG,
  MENU_BAR_POPOVER_VARIANTS,
} from "@/lib/menu-bar-popover-flag";

/** One selectable override value for a flag, plus its human-facing label. */
type FlagOverrideOption = { value: string; label: string };

/**
 * A string-valued feature flag a developer can override locally from the
 * Developer settings tab. Most entries are PostHog-backed; launch-time native
 * flags can opt into local-only copy with `description` and `defaultLabel`.
 *
 * The override is persisted as a string in
 * `GlobalPreferences.featureFlagOverrides`. Each flag's consumer reads that
 * map directly; PostHog-backed JS flags do so through `useFeatureFlag`. Only
 * string-valued (multivariate) flags belong here — list each variant key in
 * `options`. Boolean flags are intentionally unsupported: a `"false"` string
 * would read back truthy at the call site.
 */
type OverridableFlag = {
  /** Flag key; also the key under `featureFlagOverrides`. */
  key: string;
  /** Optional human label; defaults to the raw key when omitted. */
  label?: string;
  /** Optional explanation shown beneath the flag name. */
  description?: string;
  /** Optional reset label; defaults to "PostHog default". */
  defaultLabel?: string;
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
  {
    key: MENU_BAR_POPOVER_FLAG,
    label: "Menu bar popover",
    description:
      "Launch-time local override; this flag is not read from PostHog. Takes effect after restart.",
    defaultLabel: "Default (control)",
    options: MENU_BAR_POPOVER_VARIANTS.filter((variant) => variant !== "control").map(
      (variant) => ({
        value: variant,
        label: "Popover",
      }),
    ),
  },
];
