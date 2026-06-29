import { useEffect, useState } from "react";
import { useViewModel } from "@nixmac/state";
import { useTelemetry } from "./context";

/**
 * Reactively read a PostHog feature flag, with optional local override.
 *
 * PostHog loads flags asynchronously after init, so the value can start out
 * `undefined` and resolve a moment later. This hook reads the current value
 * (posthog-js restores cached flags from localStorage eagerly, so a returning
 * user often gets it on first render) and re-reads whenever flags refresh.
 *
 * If a developer override exists in `GlobalPreferences.featureFlagOverrides`
 * for this key, it takes precedence over the PostHog value — this lets devs
 * test flag variants locally even when telemetry/diagnostics are disabled.
 *
 * Returns the variant key for multivariate flags, `true`/`false` for boolean
 * flags, or `undefined` while loading / when telemetry is disabled.
 */
export function useFeatureFlag(key: string): boolean | string | undefined {
  const telemetry = useTelemetry();
  const override = useViewModel(
    (s) => s.preferences?.featureFlagOverrides?.[key],
  );
  const [value, setValue] = useState<boolean | string | undefined>(() =>
    telemetry.getFeatureFlag(key),
  );

  useEffect(() => {
    setValue(telemetry.getFeatureFlag(key));
    return telemetry.onFeatureFlags(() => {
      setValue(telemetry.getFeatureFlag(key));
    });
  }, [telemetry, key]);

  return override ?? value;
}
