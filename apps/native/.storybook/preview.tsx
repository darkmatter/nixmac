import type { Decorator } from "@storybook/react-vite";
import { definePreview } from "@storybook/react-vite";
import { useEffect } from "react";
import "./mocks/tauri-runtime";
import "../src/index.css";
import { useWidgetStore } from "../src/stores/widget-store";

// Pre-seed the widget store at module-load time so components never see the
// default null/false values (which would show the nix-setup or permissions
// screens). This runs synchronously before any story renders.
const grantedPermissionsState = () => ({
  permissions: [],
  allRequiredGranted: true,
  checkedAt: Date.now(),
});

const bypassSeed = () => ({
  nixInstalled: true,
  darwinRebuildAvailable: true,
  permissionsChecked: true,
  permissionsState: grantedPermissionsState(),
});

useWidgetStore.setState({
  ...bypassSeed(),
  configDir: "/Users/demo/.darwin",
  hosts: ["Demo-MacBook-Pro", "Work-MacBook"],
  host: "Demo-MacBook-Pro",
});

// Stories render the same `DarwinWidget` whose mount effect re-runs
// `checkNix`, `checkPermissions`, and `loadConfig` against the Storybook
// mocks. If a mock throws (or a story momentarily flips a value to test a
// screen), the user falls into the nix-setup or permissions surface —
// not what most stories want.
//
// We monkey-patch the offending setters so they cannot push the bypass
// invariants out of "all true" no matter what the production code does.
// Stories that need to *exercise* nix-setup / permissions should test the
// step component directly via `nix-setup-step.stories.tsx` /
// `permissions-step.stories.tsx`, where these patches are irrelevant.
const realStore = useWidgetStore.getState();
const pinNixInstalled = (_value: boolean | null) => realStore.setNixInstalled(true);
const pinDarwinRebuildAvailable = (_value: boolean | null) =>
  realStore.setDarwinRebuildAvailable(true);
const pinPermissionsChecked = (_value: boolean) => realStore.setPermissionsChecked(true);
const pinPermissionsState = (_value: unknown) => realStore.setPermissionsState(grantedPermissionsState());

// `use-error-handler` and `use-panic-handler` open the FeedbackDialog when they
// catch a JS error, and the dialog itself has render edge cases that surface
// as cryptic stacks if it ever opens during a story. Force-close it.
const pinFeedbackClosed = (_value: boolean) => realStore.setFeedbackOpen(false);
const pinOpenFeedbackNoop = (..._args: unknown[]) => undefined;

useWidgetStore.setState({
  setNixInstalled: pinNixInstalled,
  setDarwinRebuildAvailable: pinDarwinRebuildAvailable,
  setPermissionsChecked: pinPermissionsChecked,
  setPermissionsState: pinPermissionsState,
  setFeedbackOpen: pinFeedbackClosed,
  openFeedback: pinOpenFeedbackNoop,
});

// Belt-and-braces: a 250ms watchdog re-asserts the bypass if anything else
// (e.g. a `setState` partial that bypasses the patched setters) drifts. Logs
// to console once so the bypass is auditable from devtools.
let bypassLogged = false;
setInterval(() => {
  const s = useWidgetStore.getState();
  const drifted =
    s.nixInstalled !== true ||
    s.darwinRebuildAvailable !== true ||
    !s.permissionsChecked ||
    !s.permissionsState?.allRequiredGranted;
  if (!drifted) return;
  useWidgetStore.setState(bypassSeed());
  if (!bypassLogged) {
    bypassLogged = true;
    console.info("[storybook] bypass re-asserted (nix-setup / permissions)");
  }
}, 250);

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
