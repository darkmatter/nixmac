// View-model sync shim layer.
//
// This module bridges Rust-emitted Tauri events to Zustand stores. Each
// sub-module (`evolve`, `git`, `change-map`, `preferences`, `permissions`,
// `prompt-history`) listens for a specific event, hydrates through the
// matching command, then mirrors payloads into the read-optimized ViewModel.
// UI-only reactions, such as surfacing an error string, go through
// `useUiState`.
//
// `startViewModelSync()` is called once on app mount; the returned cleanup
// function tears down all listeners on unmount.

import { startChangeMapSync } from "./change-map";
import { startEvolveSync } from "./evolve";
import { startGitSync } from "./git";
import { startPermissionsSync } from "./permissions";
import { startPreferencesSync } from "./preferences";
import { startPromptHistorySync } from "./prompt-history";

export async function startViewModelSync(): Promise<() => void> {
  const unlisteners: Array<() => void> = [];

  try {
    unlisteners.push(await startEvolveSync());
    unlisteners.push(await startGitSync());
    unlisteners.push(await startChangeMapSync());
    unlisteners.push(await startPreferencesSync());
    unlisteners.push(await startPermissionsSync());
    unlisteners.push(await startPromptHistorySync());

    return () => {
      for (const unlisten of unlisteners) {
        unlisten();
      }
    };
  } catch (error) {
    for (const unlisten of unlisteners) {
      unlisten();
    }
    throw error;
  }
}
