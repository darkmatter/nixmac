import { DarwinWidget } from "@/components/widget/widget";
import { bootBreadcrumb, clearBootStage, markBootStage } from "@/lib/boot-diagnostics";
import { useEffect } from "react";
import { Toaster } from "sonner";

export default function App() {
  markBootStage("app-render");

  useEffect(() => {
    markBootStage("app-effect");
    bootBreadcrumb("App mounted");
    window.dispatchEvent(new Event("nixmac:app-mounted"));
    clearBootStage();
  }, []);

  return (
    <>
      <DarwinWidget />
      <Toaster
        position="top-center"
        theme="dark"
        toastOptions={{
          classNames: {
            success: "!bg-teal-900 !border-teal-500/50 !text-teal-100",
            title: "!text-teal-100",
            description: "!text-teal-200",
          },
        }}
      />
    </>
  );
}
