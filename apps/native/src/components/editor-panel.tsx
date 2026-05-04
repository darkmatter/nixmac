import { X } from "lucide-react";
import { NixEditor } from "@/components/nix-editor";
import { Button } from "@/components/ui/button";
import { useWidgetStore } from "@/stores/widget-store";
import { Component, type ErrorInfo, type ReactNode } from "react";

class EditorErrorBoundary extends Component<
  { children: ReactNode; onError: () => void },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    this.props.onError();
  }

  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

export function EditorPanel({ disableEditorRuntime = false }: { disableEditorRuntime?: boolean }) {
  const editingFile = useWidgetStore((s) => s.editingFile);

  if (!editingFile) return null;

  const close = () => useWidgetStore.setState({ editingFile: null });

  const filename = editingFile.split("/").pop() ?? editingFile;

  return (
    <EditorErrorBoundary onError={close}>
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
        <NixEditor
          filePath={editingFile}
          className="flex-1"
          disableRuntime={disableEditorRuntime}
          onSave={() => {
            // Could trigger a git status refresh here in the future
          }}
        />
      </div>
    </EditorErrorBoundary>
  );
}
