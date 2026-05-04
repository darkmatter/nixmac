// Stub for @tauri-apps/api/app used in Storybook.
// The real module reads metadata from the Tauri runtime which doesn't exist
// in a browser-only Storybook session.

export async function getVersion(): Promise<string> {
  return "0.22.0";
}

export async function getName(): Promise<string> {
  return "nixmac";
}

export async function getTauriVersion(): Promise<string> {
  return "2.0.0";
}
