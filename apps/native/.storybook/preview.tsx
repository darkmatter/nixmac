import type { Decorator } from "@storybook/react-vite";
import { definePreview } from "@storybook/react-vite";
import { useEffect } from "react";
import "./mocks/tauri-runtime";
import "../src/index.css";
import { useWidgetStore } from "../src/stores/widget-store";

// Pre-seed the widget store at module-load time so components never see the
// default null/false values (which would show the nix-setup or permissions
// screens). This runs synchronously before any story renders.
useWidgetStore.setState({
  nixInstalled: true,
  darwinRebuildAvailable: true,
  permissionsChecked: true,
  permissionsState: {
    permissions: [],
    allRequiredGranted: true,
    checkedAt: Date.now(),
  },
  configDir: "/Users/demo/.darwin",
  hosts: ["Demo-MacBook-Pro", "Work-MacBook"],
  host: "Demo-MacBook-Pro",
});

// Stories render the same `DarwinWidget` whose mount effect re-runs
// `checkNix`, `checkPermissions`, and `loadConfig` against the
// Storybook mocks. If a mock throws (or a story sets `nixInstalled`
// back to null/false to test that surface), the user falls into the
// nix-setup or permissions screens — not what most stories want.
//
// This subscriber pins the bypass invariants whenever they drift, so
// the default state is "pretend Nix and permissions are good." Stories
// that want to *exercise* those screens can still flip the values
// momentarily — the subscriber re-asserts after the next microtask,
// which is fine for static visual review, and stories that need the
// screen long enough to inspect can opt out via story-level state
// that re-applies their override on a timer (or be moved to
// `permissions-step.stories.tsx` / `nix-setup-step.stories.tsx`,
// which test the components directly without the full widget shell).
useWidgetStore.subscribe((state) => {
  const drifted =
    state.nixInstalled !== true ||
    state.darwinRebuildAvailable !== true ||
    !state.permissionsChecked ||
    !state.permissionsState?.allRequiredGranted;
  if (!drifted) return;
  queueMicrotask(() => {
    useWidgetStore.setState({
      nixInstalled: true,
      darwinRebuildAvailable: true,
      permissionsChecked: true,
      permissionsState: {
        permissions: [],
        allRequiredGranted: true,
        checkedAt: Date.now(),
      },
    });
  });
});

/**
 * Decorator that applies the dark theme class to the document.
 * This ensures CSS custom properties from .dark {} are active.
 */
const withDarkTheme: Decorator = (Story) => {
  useEffect(() => {
    document.documentElement.classList.add("dark");
    return () => {
      document.documentElement.classList.remove("dark");
    };
  }, []);

  return <Story />;
};

const preview = definePreview({
  addons: [],
  tags: ["autodocs", "test"],
  parameters: {
    layout: "padded",
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: {
      options: {
        dark: { name: "dark", value: "#0a0a0b" },
        zinc: { name: "zinc", value: "#18181b" },
        light: { name: "light", value: "#ffffff" },
      },
      default: "dark",
    },
  },
  initialGlobals: {
    // 👇 Set the initial background color
    backgrounds: { value: "dark" },
  },
  decorators: [withDarkTheme],
});

export default preview;
