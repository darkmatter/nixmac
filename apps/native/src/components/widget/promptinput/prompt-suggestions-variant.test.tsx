import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  resolvePromptSuggestionsVariant,
  usePromptSuggestionsVariant,
} from "@/components/widget/promptinput/prompt-suggestions-variant";
import { TelemetryContextProvider } from "@/lib/telemetry/context";
import type { TelemetryProvider } from "@/lib/telemetry/types";

/** Minimal telemetry provider whose feature flag value can be changed at runtime. */
function makeFlagProvider(initial: boolean | string | undefined) {
  let value = initial;
  const listeners = new Set<() => void>();
  const provider: TelemetryProvider = {
    enabled: true,
    captureEvent() { },
    captureError() { },
    setEnabled() { },
    reset() { },
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

describe("resolvePromptSuggestionsVariant", () => {
  it("returns the known variants verbatim", () => {
    expect(resolvePromptSuggestionsVariant("chips")).toBe("chips");
    expect(resolvePromptSuggestionsVariant("spotlight")).toBe("spotlight");
    expect(resolvePromptSuggestionsVariant("trending")).toBe("trending");
  });

  it("falls back to the control variant for unset / unknown / boolean values", () => {
    expect(resolvePromptSuggestionsVariant(undefined)).toBe("spotlight");
    expect(resolvePromptSuggestionsVariant(true)).toBe("spotlight");
    expect(resolvePromptSuggestionsVariant("mystery-variant")).toBe("spotlight");
  });
});

describe("usePromptSuggestionsVariant", () => {
  it("defaults to spotlight outside a telemetry provider", () => {
    const { result } = renderHook(() => usePromptSuggestionsVariant());
    expect(result.current).toBe("spotlight");
  });

  it("reflects the PostHog flag and updates when flags refresh", () => {
    const { provider, setFlag } = makeFlagProvider("spotlight");
    const { result } = renderHook(() => usePromptSuggestionsVariant(), {
      wrapper: ({ children }) => (
        <TelemetryContextProvider value={provider}>{children}</TelemetryContextProvider>
      ),
    });

    expect(result.current).toBe("spotlight");

    act(() => setFlag("trending"));
    expect(result.current).toBe("trending");

    act(() => setFlag(undefined));
    expect(result.current).toBe("spotlight");
  });
});
