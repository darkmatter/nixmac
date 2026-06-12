// Storybook manual mock for the widget store. Activated via
// `sb.mock(import("../stores/widget-store"))` in `.storybook/preview.tsx`.
//
// The real store is delegated to for *all* state — we just clamp the
// bypass invariants (Nix installed, nix-darwin available) so a
// `DarwinWidget` mounted inside a story can never fall into the
// nix-setup screen, regardless of what `checkNix` resolves to against
// the Storybook mocks. The permissions/config bypass lives in the
// ViewModel now, so it is seeded there instead (see below).
//
// Inside `__mocks__`, the relative import resolves to the un-mocked
// original module — that's the manual-mock contract Storybook
// inherits from Vitest.
import { createWidgetStore as createRealWidgetStore, type WidgetState } from "@/stores/widget-store.impl";
import { useViewModel } from "@/stores/view-model";
import { makeGlobalPreferences, makeGrantedPermissions } from "@/utils/test-fixtures";

export type { WidgetState } from "@/stores/widget-store.impl";

// =============================================================================
// Bypass invariants — these never drift from "all granted, all installed."
// =============================================================================

const BYPASS_KEYS = [
  "nixInstalled",
  "darwinRebuildAvailable",
] as const satisfies ReadonlyArray<keyof WidgetState>;

function bypassValues(): Pick<WidgetState, (typeof BYPASS_KEYS)[number]> {
  return {
    nixInstalled: true,
    darwinRebuildAvailable: true,
  };
}

function clampBypass<T extends Partial<WidgetState>>(partial: T): T {
  // Always re-assert bypass values; if the caller passed `nixInstalled: false`
  // or similar, our bypass wins.
  return { ...partial, ...bypassValues() } as T;
}

// =============================================================================
// ViewModel bypass seeding — permissions granted, demo config selected
// =============================================================================

function seedViewModelBypass() {
  const current = useViewModel.getState();
  useViewModel.setState({
    permissions: makeGrantedPermissions(),
    permissionsHydrated: true,
    preferences:
      current.preferences ??
      makeGlobalPreferences({
        hostAttr: "Demo-MacBook-Pro",
        configDir: "/Users/demo/.darwin",
        repoRoot: "/Users/demo/.darwin",
      }),
    hosts: current.hosts.length > 0 ? current.hosts : ["Demo-MacBook-Pro", "Work-MacBook"],
  });
}

// =============================================================================
// Wrap createWidgetStore so every store instance is bypass-clamped
// =============================================================================

export function createWidgetStore(initialState?: Partial<WidgetState>) {
  const real = createRealWidgetStore(initialState);

  // Permissions/config bypass lives in the ViewModel — stories never fall
  // into the permissions or setup screens.
  seedViewModelBypass();

  // Pre-seed bypass values for fields downstream stories rely on.
  real.setState(bypassValues());

  // Re-assert bypass invariants if any of their setters are called.
  // (The feedback-dialog no-ops moved with the feedback state to ui-state;
  // stories needing ui-state values should call useUiState.setState directly.)
  real.setState({
    setNixInstalled: () => real.setState({ nixInstalled: true }),
    setDarwinRebuildAvailable: () => real.setState({ darwinRebuildAvailable: true }),
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
import { useUiState } from "@/stores/ui-state";
import type { WidgetStep } from "@/types/widget";

export function useCurrentStep(): WidgetStep {
  const evolveState = useViewModel((state) => state.evolve);
  const configDir = useViewModel((state) => state.preferences?.configDir ?? "");
  const host = useViewModel((state) => state.preferences?.hostAttr ?? "");
  const hosts = useViewModel((state) => state.hosts);
  const permissionsState = useViewModel((state) => state.permissions);
  const permissionsChecked = useViewModel((state) => state.permissionsHydrated);
  const showHistory = useUiState((state) => state.showHistory);
  const showFilesystem = useUiState((state) => state.showFilesystem);
  const isBootstrapping = useUiState((state) => state.isBootstrapping);
  return useWidgetStore((state) =>
    computeCurrentStep({
      ...state,
      configDir,
      host,
      hosts,
      permissionsState,
      permissionsChecked,
      evolveState,
      showHistory,
      showFilesystem,
      isBootstrapping,
    }),
  );
}
