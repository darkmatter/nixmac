import { useFeatureFlag } from "@/lib/telemetry/use-feature-flag";

/**
 * PostHog multivariate flag controlling whether the CLI providers (Claude,
 * Codex, OpenCode) appear in provider pickers. They are currently broken, so
 * the default is to hide them.
 *
 * Configure in PostHog with these variant keys:
 * - `hidden`  — CLI providers are hidden from pickers (control / safe default)
 * - `visible` — CLI providers are selectable
 */
export const CLI_PROVIDERS_FLAG = "cli-providers";

export const CLI_PROVIDERS_VARIANTS: readonly string[] = ["hidden", "visible"];

/**
 * Map a raw flag value to visibility, hiding while the flag is unset, loading,
 * or unrecognized (tests, Storybook, diagnostics off).
 */
export function resolveCliProvidersVisible(
	flag: boolean | string | undefined,
): boolean {
	return flag === "visible";
}

/** Reactive hook: whether CLI providers should be offered in pickers. */
export function useCliProvidersVisible(): boolean {
	return resolveCliProvidersVisible(useFeatureFlag(CLI_PROVIDERS_FLAG));
}
