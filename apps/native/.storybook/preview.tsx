import addonA11y from "@storybook/addon-a11y";
import addonDocs from "@storybook/addon-docs";
import { DocsContainer } from "@storybook/addon-docs/blocks";
import type { DocsContainerProps } from "@storybook/addon-docs/blocks";
import type { Decorator } from "@storybook/react-vite";
import { definePreview } from "@storybook/react-vite";
import { sb } from "storybook/test";
import { useEffect } from "react";
import { themes, useTheme } from "storybook/theming";
import "./mocks/tauri-runtime";
import "../src/index.css";

// Replace the widget-store module wholesale with a clamped variant that
// can never drift the nix-setup / permissions / feedback-dialog
// bypasses. The redirect target is `apps/native/src/stores/__mocks__/widget-store.ts`.
//
// Storybook's mocker resolves the path via Node's `require.resolve`, which
// doesn't know about `.ts` extensions — so we spell it out.
sb.mock(import("../src/stores/widget-store.ts"));

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

/**
 * Custom docs container that reacts to the Storybook manager theme.
 * Without this, the addon-docs panel stays light when Storybook is in dark mode.
 */
const DarkModeDocsContainer = (
  props: React.PropsWithChildren<DocsContainerProps>,
) => {
  const { base } = useTheme();
  return (
    <DocsContainer
      {...props}
      theme={base === "dark" ? themes.dark : themes.light}
    />
  );
};

const preview = definePreview({
  addons: [addonA11y(), addonDocs()],
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

    docs: {
      container: DarkModeDocsContainer,
    },

    a11y: {
      // 'todo' - show a11y violations in the test UI only
      // 'error' - fail CI on a11y violations
      // 'off' - skip a11y checks entirely
      test: "todo",
    },
  },
  initialGlobals: {
    // 👇 Set the initial background color
    backgrounds: { value: "dark" },
  },
  decorators: [withDarkTheme],
});

export default preview;
