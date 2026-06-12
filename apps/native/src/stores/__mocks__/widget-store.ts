// Storybook manual mock for the widget store. Activated via
// `sb.mock(import("../stores/widget-store"))` in `.storybook/preview.tsx`.
//
// The store itself is empty now — every bypass invariant lives in the
// ViewModel, so we just seed it (permissions granted, demo config selected,
// Nix installed and nix-darwin available) so a `DarwinWidget` mounted inside
// a story can never fall into the permissions/setup/nix-setup screens.
//
// Inside `__mocks__`, the relative import resolves to the un-mocked
// original module — that's the manual-mock contract Storybook
// inherits from Vitest.
import {
  createWidgetStore as createRealWidgetStore,
  type WidgetState,
} from "@/stores/widget-store.impl";
import { useViewModel } from "@/stores/view-model";
import {
  makeGlobalPreferences,
  makeGrantedPermissions,
  makeNixInstallState,
} from "@/utils/test-fixtures";

export type { WidgetState } from "@/stores/widget-store.impl";

// `useCurrentStep` no longer reads the widget store; re-export the real,
// selector-based implementation from the un-mocked impl module.
export { useCurrentStep } from "@/stores/widget-store.impl";

// =============================================================================
// ViewModel bypass seeding — permissions granted, Nix ready, demo config
// =============================================================================

function seedViewModelBypass() {
  const current = useViewModel.getState();
  useViewModel.setState({
    permissions: makeGrantedPermissions(),
    permissionsHydrated: true,
    nixInstall: makeNixInstallState(),
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
// Wrap createWidgetStore so every store instance re-seeds the bypass
// =============================================================================

export function createWidgetStore(initialState?: Partial<WidgetState>) {
  // Stories never fall into the permissions, setup, or nix-setup screens.
  seedViewModelBypass();
  return createRealWidgetStore(initialState);
}

// =============================================================================
// Default store (mirroring widget-store.ts surface)
// =============================================================================

export const useWidgetStore = createWidgetStore();
