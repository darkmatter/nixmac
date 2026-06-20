import addonA11y from "@storybook/addon-a11y";
import addonDocs from "@storybook/addon-docs";
import { DocsContainer } from "@storybook/addon-docs/blocks";
import type { DocsContainerProps } from "@storybook/addon-docs/blocks";
import type { Decorator } from "@storybook/react-vite";
import { definePreview } from "@storybook/react-vite";
import { useEffect } from "react";
import { themes, useTheme } from "storybook/theming";
import "./mocks/tauri-runtime";
import darkTheme from "./theme";
import "../src/index.css";

import { seedViewModelBypass } from "../src/utils/test-fixtures";

/**
 * Decorator that seeds the ViewModel bypass invariants (permissions granted,
 * Nix ready, demo config) before every story render. Replaces the old
 * widget-store manual mock; story decorators run after this and can
 * override any field.
 */
const withViewModelBypass: Decorator = (Story) => {
  seedViewModelBypass();
  return <Story />;
};

/**
 * Decorator that applies the dark theme class to the document.
 * This ensures CSS custom properties from .dark {} are active.
 */
const withDarkTheme: Decorator = (Story) => {
  useEffect(() => {
    document.documentElement.classList.add("dark");
    const sbRoot = document.getElementsByClassName(
          'sb-show-main',
        )[0] as HTMLElement;
        if (sbRoot) {
          sbRoot.style.backgroundColor = darkTheme.appBg;
        }
    return () => {
      document.documentElement.classList.remove("dark");
      const sbRoot = document.getElementsByClassName(
        'sb-show-main',
      )[0] as HTMLElement;
      if (sbRoot) {
        sbRoot.style.backgroundColor = "";
      }
    };
  }, []);

  return <Story />;
};


// CI-only: when capturing screenshots of failed snapshot stories, this regex
// (built from the failed story names by scripts/resolve-failed-stories.mjs) is
// injected at build time so Creevey skips every story whose name is NOT in the
// failed set. Unset in normal builds, so this is a no-op for dev/Vitest.
const creeveySkipRegex = import.meta.env.VITE_CREEVEY_SKIP_REGEX as
  | string
  | undefined;

const creeveyParameters = creeveySkipRegex
  ? {
      creevey: {
        captureElement: "#storybook-root",
        skip: {
          "capture only failed snapshot stories": {
            stories: new RegExp(creeveySkipRegex),
          },
        },
      },
    }
  : {};

const preview = definePreview({
  addons: [addonA11y(), addonDocs()],
  tags: ["autodocs", "test"],
  parameters: {
    ...creeveyParameters,
    layout: "centered",

    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },

    backgrounds: {
      options: {
        dark: { ...darkTheme, name: "dark", value: darkTheme.appBg },
        light: { name: "light", value: "#0c0c0e" },
      },
      default: "dark",
    },

    docs: {
      theme: darkTheme,
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
  decorators: [withViewModelBypass, withDarkTheme],
});

export default preview;
