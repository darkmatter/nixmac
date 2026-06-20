import { useState, useEffect } from 'react';
import { addons } from 'storybook/preview-api';
import { DARK_MODE_EVENT_NAME } from '@vueless/storybook-dark-mode';

const channel = addons.getChannel()

/**
 * Use this hook if you want to pass in your own callback, e.g. Mantine's `setColorScheme`
 **/
export function useOnDarkModeEvent(callback: (isDarkMode: any) => any) {
  useEffect(function () {
    channel.on(DARK_MODE_EVENT_NAME, callback)
    return () => channel.off(DARK_MODE_EVENT_NAME, callback)
  })
}

/**
 * Use this hook if you only need to know whether dark mode is toggled on
 **/
export function useIsDarkMode() {
  // Default to true: the dark-mode addon only emits DARK_MODE_EVENT_NAME on
  // toggle, not on initial mount. Without this default, DocsContainer would
  // render light on load (undefined ? dark : light) and stay light until the
  // user toggles. parameters.darkMode.current: "dark" keeps this in sync.
  const [isDarkMode, setIsDarkMode] = useState(undefined)
  useOnDarkModeEvent(setIsDarkMode)
  return isDarkMode
}
