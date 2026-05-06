import { DarwinWidget } from "@/components/widget/widget";
import { bootBreadcrumb } from "@/lib/e2e-boot-diagnostics";
import { useEffect } from "react";
import { Toaster } from "sonner";

export default function App() {
  useEffect(() => {
    bootBreadcrumb("App mounted");
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
