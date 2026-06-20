import addonA11y from "@storybook/addon-a11y";
import addonDocs from "@storybook/addon-docs";
import { DocsContainer } from "@storybook/addon-docs/blocks";
import type { DocsContainerProps } from "@storybook/addon-docs/blocks";
import type { Decorator } from "@storybook/react-vite";
import { definePreview } from "@storybook/react-vite";
import { useEffect } from "react";
import { themes, useTheme } from "storybook/theming";
import theme from "./theme";
import "./mocks/tauri-runtime";
import { useIsDarkMode } from './hooks'; // the hook we defined above

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
 * Custom docs container that reacts to the Storybook manager theme.
 * Without this, the addon-docs panel stays light when Storybook is in dark mode.
 */
function ThemedDocsContainer(props: any) {
  const isDarkMode = useIsDarkMode() // the hook we defined above

  return (
    <DocsContainer theme={isDarkMode ? theme : theme} context={props.context}>
      {props.children}
    </DocsContainer>
  )
}


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
    layout: "padded",

    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },

    darkMode: {
      current: "dark",
      dark: theme,
      light: theme,
    },

    docs: {
      container: ThemedDocsContainer
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
  decorators: [withViewModelBypass],
});

export default preview;
