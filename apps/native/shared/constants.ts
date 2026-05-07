// Shared app constants for easy renaming/rebranding
export const APP_NAME = "nixmac";
export const DEFAULT_MAX_ITERATIONS = 25;
export const EVOLVE_EVENT_CHANNEL = "darwin:evolve:event";
// If you change icons, update these to point to your bundled assets
export const APP_TRAY_ICON = "image.png"; // under APP_ROOT / resources as used in main
export const APP_OVERLAY_ICON = "/activation.png"; // served by Vite/public in dev
export const APP_DOCK_ICON = "resources/icon.icns"; // macOS Dock icon (dev). Packaging uses electron-builder icon.
