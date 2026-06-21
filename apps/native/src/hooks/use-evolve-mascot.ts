import { useEffect } from "react";
import { tauriAPI } from "@/ipc/api";
import { useUiState } from "@nixmac/state";
import { useViewModel } from "@nixmac/state";

/**
 * Experimental: drives the spinning-mascot corner-indicator window.
 *
 * When the `experimentalSpinningMascot` developer setting is enabled, the mascot
 * window is shown — a 3D token turning on its Y axis — while an evolution is
 * generating or a darwin-rebuild is running, and hidden otherwise.
 *
 * Mounted once from the main widget. The window itself is created lazily by the
 * Rust `peek` module on first show, so this costs nothing when the flag is off.
 */
export function useEvolveMascot() {
  const enabled = useViewModel((s) => s.preferences?.experimentalSpinningMascot ?? false);
  const isGenerating = useUiState((s) => s.isGenerating);
  const rebuildRunning = useViewModel((s) => s.rebuildStatus?.isRunning ?? false);

  const shouldShow = enabled && (isGenerating || rebuildRunning);

  useEffect(() => {
    const toggle = shouldShow ? tauriAPI.evolveMascot.show : tauriAPI.evolveMascot.hide;
    toggle().catch((err) => {
      console.error("[evolve-mascot] failed to toggle indicator:", err);
    });
  }, [shouldShow]);

  // Safety net: hide the indicator on teardown so it can't linger on screen.
  useEffect(() => {
    return () => {
      tauriAPI.evolveMascot.hide().catch(() => {
        // Ignore — the window may not have been created.
      });
    };
  }, []);
}
