import { X } from "lucide-react";
import { NixEditor } from "@/components/kibo-ui/nix-editor";
import { Button } from "@/components/ui/button";
import { isE2eProofMode } from "@/utils/e2e-proof-mode";
import { useWidgetStore } from "@/stores/widget-store";

export function EditorPanel() {
  const editingFile = useWidgetStore((s) => s.editingFile);

  if (!editingFile) return null;

  const close = () => useWidgetStore.setState({ editingFile: null });

  const filename = editingFile.split("/").pop() ?? editingFile;

  return (
    <div
      className={
        isE2eProofMode
          ? "fixed inset-y-8 w-full max-w-[100vw] z-20 flex flex-col bg-background"
          : "fixed inset-y-8 w-full max-w-[100vw] z-20 flex flex-col bg-background/95 backdrop-blur-sm"
      }
    >
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
      <NixEditor
        filePath={editingFile}
        className="flex-1"
        onSave={() => {
          // Could trigger a git status refresh here in the future
        }}
      />
    </div>
  );
}
