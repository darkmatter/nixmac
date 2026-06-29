import { act, renderHook } from "@testing-library/react";
import { viewModelActions } from "@nixmac/state";
import { beforeEach, describe, expect, it } from "vitest";

import { TelemetryContextProvider } from "@/lib/telemetry/context";
import type { TelemetryProvider } from "@/lib/telemetry/types";
import { useFeatureFlag } from "@/lib/telemetry/use-feature-flag";
import { makeGlobalPreferences } from "@/utils/test-fixtures";

const FLAG = "evolve-prompt-suggestions";

/** Minimal telemetry provider whose feature flag value can be changed at runtime. */
function makeFlagProvider(initial: boolean | string | undefined) {
  let value = initial;
  const listeners = new Set<() => void>();
  const provider: TelemetryProvider = {
    enabled: true,
    captureEvent() {},
    captureError() {},
    setEnabled() {},
    reset() {},
    getFeatureFlag: () => value,
    onFeatureFlags: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
  const setFlag = (next: boolean | string | undefined) => {
    value = next;
    for (const cb of listeners) cb();
  };
  return { provider, setFlag };
}

function withOverride(variant: string | null) {
  viewModelActions.patch({
    preferences: makeGlobalPreferences({
      featureFlagOverrides: variant === null ? null : { [FLAG]: variant },
    }),
  });
}

describe("useFeatureFlag", () => {
  beforeEach(() => {
    viewModelActions.reset();
  });

  it("returns the PostHog value when no developer override is set", () => {
    const { provider } = makeFlagProvider("spotlight");
    const { result } = renderHook(() => useFeatureFlag(FLAG), {
      wrapper: ({ children }) => (
        <TelemetryContextProvider value={provider}>{children}</TelemetryContextProvider>
      ),
    });
    expect(result.current).toBe("spotlight");
  });

  it("lets a developer override take precedence over the PostHog value", () => {
    withOverride("trending");
    const { provider } = makeFlagProvider("spotlight");
    const { result } = renderHook(() => useFeatureFlag(FLAG), {
      wrapper: ({ children }) => (
        <TelemetryContextProvider value={provider}>{children}</TelemetryContextProvider>
      ),
    });
    expect(result.current).toBe("trending");
  });

  it("applies the override even when telemetry has no value (diagnostics off)", () => {
    withOverride("spotlight");
    const { provider } = makeFlagProvider(undefined);
    const { result } = renderHook(() => useFeatureFlag(FLAG), {
      wrapper: ({ children }) => (
        <TelemetryContextProvider value={provider}>{children}</TelemetryContextProvider>
      ),
    });
    expect(result.current).toBe("spotlight");
  });

  it("falls back to the PostHog value when the override is cleared", () => {
    withOverride("trending");
    const { provider } = makeFlagProvider("spotlight");
    const { result, rerender } = renderHook(() => useFeatureFlag(FLAG), {
      wrapper: ({ children }) => (
        <TelemetryContextProvider value={provider}>{children}</TelemetryContextProvider>
      ),
    });
    expect(result.current).toBe("trending");

    act(() => withOverride(null));
    rerender();
    expect(result.current).toBe("spotlight");
  });
});
