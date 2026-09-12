/**
 * Launch-time, local-only window-mode override read by the Rust shell.
 *
 * PostHog remains JS-only in v1, so an unset or unrecognized value resolves to
 * `control` in Rust. Keep these values string-based: boolean override strings
 * such as `"false"` are truthy at existing JavaScript flag call sites.
 */
export const MENU_BAR_POPOVER_FLAG = "menu-bar-popover";

export const MENU_BAR_POPOVER_VARIANTS = ["control", "popover"] as const;
