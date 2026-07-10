import { useDiagnosticsNotice } from "@/hooks/use-diagnostics-notice";
import { useAuthDeepLink } from "@/lib/auth-deep-link";
import { bootBreadcrumb, clearBootStage, markBootStage } from "@/lib/boot-diagnostics";
import { useTelemetry } from "@/lib/telemetry/context";
import { RouterProvider, router } from "@/router";
import { AlertTriangle, Check, Info } from "lucide-react";
import { useEffect } from "react";
import { Toaster } from "sonner";

export default function App() {
  useAuthDeepLink();
  useDiagnosticsNotice();
  const telemetry = useTelemetry();

  useEffect(() => {
    markBootStage("app-effect");
    bootBreadcrumb("App mounted");
    window.dispatchEvent(new Event("nixmac:app-mounted"));
    // performance.now() is time since the webview's timeOrigin — page load.
    telemetry.captureEvent({ name: "app_ready", props: { boot_ms: Math.round(performance.now()) } });
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
      <RouterProvider router={router} />
      <Toaster
        position="bottom-right"
        icons={{
          success: <Check className="h-4 w-4" />,
          info: <Info className="h-4 w-4" />,
          warning: <AlertTriangle className="h-4 w-4" />,
          error: <AlertTriangle className="h-4 w-4" />,
        }}
        theme="dark"
        toastOptions={{
          classNames: {
            // success: "bg-emerald-900! border-emerald-500/50! text-emerald-100!",
            // title: "text-foreground!",
            description: "text-muted-foreground!",
          },
        }}
      />
    </>
  );
}
