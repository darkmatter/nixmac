// Storybook manual mock for the widget store. Activated via
// `sb.mock(import("../stores/widget-store"))` in `.storybook/preview.tsx`.
//
// The real store is delegated to for *all* state — we just clamp the
// bypass invariants (Nix installed, nix-darwin available, permissions
// granted) so a `DarwinWidget` mounted inside a story can never fall
// into the nix-setup or permissions screens, regardless of what
// `checkNix` / `checkPermissions` resolve to against the Storybook
// mocks.
//
// Inside `__mocks__`, the relative import resolves to the un-mocked
// original module — that's the manual-mock contract Storybook
// inherits from Vitest.
import {
  createWidgetStore as createRealWidgetStore,
  type WidgetStore,
} from "@/stores/widget-store.impl";

type WidgetState = WidgetStore;

// =============================================================================
// Bypass invariants — these never drift from "all granted, all installed."
// =============================================================================

const BYPASS_KEYS = [
  "nixInstalled",
  "darwinRebuildAvailable",
  "permissionsChecked",
  "permissionsState",
] as const satisfies ReadonlyArray<keyof WidgetState>;

function bypassValues(): Pick<WidgetState, (typeof BYPASS_KEYS)[number]> {
  return {
    nixInstalled: true,
    darwinRebuildAvailable: true,
    permissionsChecked: true,
    permissionsState: {
      permissions: [],
      allRequiredGranted: true,
      checkedAt: Date.now(),
    },
  };
}

function clampBypass<T extends Partial<WidgetState>>(partial: T): T {
  // Always re-assert bypass values; if the caller passed `nixInstalled: false`
  // or similar, our bypass wins.
  return { ...partial, ...bypassValues() } as T;
}

// =============================================================================
// Wrap createWidgetStore so every store instance is bypass-clamped
// =============================================================================

export function createWidgetStore(initialState?: Partial<WidgetState>) {
  const real = createRealWidgetStore(initialState);

  // Pre-seed bypass + sensible defaults for fields downstream stories rely on.
  real.setState({
    ...bypassValues(),
    configDir: real.getState().configDir || "/Users/demo/.darwin",
    hosts:
      real.getState().hosts.length > 0
        ? real.getState().hosts
        : ["Demo-MacBook-Pro", "Work-MacBook"],
    host: real.getState().host || "Demo-MacBook-Pro",
  });

  // Clamp the setup-invariant setters so stories can never knock the bypass
  // values back to "not installed / not granted." Dialog-opening actions
  // (setFeedbackOpen / openFeedback) live on useFeedbackStore now and are
  // mocked separately in __mocks__/feedback-store.ts.
  real.setState({
    setNixInstalled: () => real.setState({ nixInstalled: true }),
    setDarwinRebuildAvailable: () => real.setState({ darwinRebuildAvailable: true }),
    setPermissionsChecked: () => real.setState({ permissionsChecked: true }),
    setPermissionsState: () => real.setState({ permissionsState: bypassValues().permissionsState }),
  });

  // Wrap setState so any partial update that names a bypass key is rewritten.
  // Functional updates (state => partial) are also clamped.
  const realSetState = real.setState.bind(real);
  // biome-ignore lint/suspicious/noExplicitAny: Zustand's setState overload typing is awkward to satisfy fully.
  (real as any).setState = (partial: any, replace?: any) => {
    if (typeof partial === "function") {
      return realSetState((state: WidgetState) => clampBypass(partial(state)), replace);
    }
    return realSetState(clampBypass(partial), replace);
  };

  return real;
}

// =============================================================================
// Default store + derived hook (mirroring widget-store.ts surface)
// =============================================================================

export const useWidgetStore = createWidgetStore();

import { computeCurrentStep } from "@/components/widget/utils";
import type { WidgetStep } from "@/components/widget/utils";
import { useUiStore } from "@/stores/ui-store";

export function useCurrentStep(): WidgetStep {
  const widgetState = useWidgetStore();
  const uiState = useUiStore();
  return computeCurrentStep({ ...widgetState, ...uiState });
}
