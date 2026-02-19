import { DarwinWidget } from "@/components/widget/widget";
import { Toaster } from "sonner";

export default function App() {
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
