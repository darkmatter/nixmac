import { X } from "lucide-react";
import { lazy, Suspense } from "react";
import { Button } from "@/components/ui/button";
import { useWidgetStore } from "@/stores/widget-store";

const LazyNixEditor = lazy(async () => {
  const module = await import("@/components/kibo-ui/nix-editor");
  return { default: module.NixEditor };
});

export function EditorPanel({ disableEditorRuntime = false }: { disableEditorRuntime?: boolean }) {
  const editingFile = useWidgetStore((s) => s.editingFile);

  if (!editingFile) return null;

  const close = () => useWidgetStore.setState({ editingFile: null });

  const filename = editingFile.split("/").pop() ?? editingFile;

  return (
    <div className="fixed inset-y-8 w-full max-w-[100vw] z-20 flex flex-col bg-background/95 backdrop-blur-sm">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Editing</span>
          <span className="font-mono font-medium">{filename}</span>
          <span className="text-muted-foreground text-xs">({editingFile})</span>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={close}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <Suspense
        fallback={
          <div className="flex flex-1 items-center justify-center text-muted-foreground text-sm">
            Loading editor...
          </div>
        }
      >
        <LazyNixEditor
          filePath={editingFile}
          className="flex-1"
          disableRuntime={disableEditorRuntime}
          onSave={() => {
            // Could trigger a git status refresh here in the future
          }}
        />
      </Suspense>
    </div>
  );
}
