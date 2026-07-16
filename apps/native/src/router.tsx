import { SettingsDialog } from "@/components/widget/settings/settings-dialog";
import { DarwinWidget } from "@/components/widget/widget";
import type { SettingsTab } from "@nixmac/state";
import { Outlet, RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter, useRouterState } from "@tanstack/react-router";

/**
 * Code-based TanStack Router for the nixmac Tauri webview.
 *
 * Uses memory history because the webview has no user-visible URL bar and the
 * window location is fixed to the bundled index.html. This gives us typed
 * navigation, search-param state, and back/forward semantics without fighting
 * Tauri's window management.
 *
 * The router owns navigation-shaped state (which overlay is up). The derived
 * widget step (begin/evolve/commit/...) stays in useCurrentStep because it is a
 * projection of backend state, not a user-navigable location.
 *
 * Architecture: DarwinWidget is mounted by the root route's layout and persists
 * across all routes — its side-effect hooks (startViewModelSync, useTrayEvents,
 * useGitOperations, etc.) must run exactly once. Overlay routes render INTO the
 * <Outlet /> slot beneath DarwinWidget, appearing as fixed-position layers on
 * top of the main view.
 */

// ---------------------------------------------------------------------------
// Route tree
// ---------------------------------------------------------------------------

const rootRoute = createRootRoute({
  component: RootLayout,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => null,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  validateSearch: (search: Record<string, unknown>) => ({
    tab: (search.tab as SettingsTab | null) ?? null,
  }),
  component: SettingsDialog,
});

const routeTree = rootRoute.addChildren([indexRoute, settingsRoute]);

// ---------------------------------------------------------------------------
// Root layout — DarwinWidget stays mounted; overlays render via <Outlet />
// ---------------------------------------------------------------------------

function RootLayout() {
  return (
    <>
      <DarwinWidget />
      <Outlet />
    </>
  );
}

// ---------------------------------------------------------------------------
// Router instance
// ---------------------------------------------------------------------------

function createAppRouter() {
  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
}

// This module sits in an import cycle: route components (SettingsDialog,
// DarwinWidget, header, tray hook, ...) import `nav` back from here. A Vite
// hot update that re-evaluates this module would otherwise mint a fresh
// router + memory history while mounted closures (Esc handler, tray listener,
// RouterProvider) still hold the previous instance — `nav` calls then drive a
// router that isn't rendered, so Close/reopen silently do nothing until a full
// reload. Pin the instance in hot.data so every evaluation shares one router.
const hotRouter = import.meta.hot?.data?.appRouter as
  | ReturnType<typeof createAppRouter>
  | undefined;

// On reuse, still swap in this evaluation's route tree so route edits apply.
hotRouter?.update({ routeTree });

export const router = hotRouter ?? createAppRouter();

if (import.meta.hot?.data) {
  import.meta.hot.data.appRouter = router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// ---------------------------------------------------------------------------
// Imperative nav helper for non-React callers (tray events, deep links, Esc)
// ---------------------------------------------------------------------------

export const nav = {
  goHome: () => router.navigate({ to: "/" }),
  openSettings: (tab?: SettingsTab) =>
    router.navigate({ to: "/settings", search: { tab: tab ?? null } }),
  closeSettings: () => router.navigate({ to: "/" }),
} as const;

// ---------------------------------------------------------------------------
// Route-aware hooks
// ---------------------------------------------------------------------------

/** True when any overlay route (non-/) is active. */
export function useIsOverlayActive(): boolean {
  return useRouterState({
    select: (s) => s.location.pathname !== "/",
  });
}

export { RouterProvider };
