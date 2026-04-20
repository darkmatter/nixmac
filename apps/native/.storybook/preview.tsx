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
