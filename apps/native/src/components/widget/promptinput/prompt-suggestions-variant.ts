import { useFeatureFlag } from "@/lib/telemetry/use-feature-flag";

/**
 * PostHog multivariate flag controlling which suggestion surface renders under
 * the evolve prompt input.
 *
 * Configure in PostHog with these variant keys:
 * - `chips`     — today's curated starter-prompt chips (control / safe default)
 * - `spotlight` — rotating "Try this" capability ticker
 * - `trending`  — mixed feed of trending packages, prompts, and ideas
 *
 * The animated typewriter placeholder is independent of this flag and always on.
 */
export const EVOLVE_PROMPT_SUGGESTIONS_FLAG = "evolve-prompt-suggestions";

export type PromptSuggestionsVariant = "chips" | "spotlight" | "trending";

const VARIANTS: readonly PromptSuggestionsVariant[] = ["chips", "spotlight", "trending"];

/** Control variant used when the flag is unset, loading, or unrecognized. */
export const DEFAULT_PROMPT_SUGGESTIONS_VARIANT: PromptSuggestionsVariant = "chips";

/**
 * Map a raw PostHog flag value to a known variant, falling back to the control
 * so the UI never breaks while flags load or in environments without PostHog
 * (tests, Storybook, diagnostics off).
 */
export function resolvePromptSuggestionsVariant(
  flag: boolean | string | undefined,
): PromptSuggestionsVariant {
  return typeof flag === "string" && (VARIANTS as readonly string[]).includes(flag)
    ? (flag as PromptSuggestionsVariant)
    : DEFAULT_PROMPT_SUGGESTIONS_VARIANT;
}

/** Reactive hook returning the active suggestion variant. */
export function usePromptSuggestionsVariant(): PromptSuggestionsVariant {
  return resolvePromptSuggestionsVariant(useFeatureFlag(EVOLVE_PROMPT_SUGGESTIONS_FLAG));
}
