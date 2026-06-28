import { DarwinWidget } from "@/components/widget/widget";
import { useAuthDeepLink } from "@/lib/auth-deep-link";
import { bootBreadcrumb, clearBootStage, markBootStage } from "@/lib/boot-diagnostics";
import { useTelemetry } from "@/lib/telemetry/context";
import { useEffect } from "react";
import { Toaster } from "sonner";

export default function App() {
  useAuthDeepLink();
  const telemetry = useTelemetry();

  useEffect(() => {
    markBootStage("app-effect");
    bootBreadcrumb("App mounted");
    window.dispatchEvent(new Event("nixmac:app-mounted"));
    telemetry.captureEvent({ name: "app_ready" });
    clearBootStage();
  }, []);

  return (
    <>
      {/*
       * Persistent window drag handle. With a custom (overlay) titlebar, the
       * window is only draggable where a `data-tauri-drag-region` element sits
       * directly under the cursor — Tauri 2.9.3's drag handler keys off
       * `e.target` only (no subtree walk / no "deep" support), so this MUST be a
       * childless leaf. It spans the top of the window, inset on the left to
       * clear the native macOS traffic lights and on the right to clear the
       * header's control buttons. Native traffic lights are composited above the
       * webview, so they stay clickable even where the strip overlaps.
       */}
      <div
        data-tauri-drag-region
        className="fixed top-0 left-20 right-44 z-30 h-7"
        aria-hidden="true"
      />
      <DarwinWidget />
      <Toaster
        position="top-center"
        theme="dark"
        toastOptions={{
          classNames: {
            success: "bg-teal-900! border-teal-500/50! text-teal-100!",
            title: "text-teal-100!",
            description: "text-teal-200!",
          },
        }}
      />
    </>
  );
}
