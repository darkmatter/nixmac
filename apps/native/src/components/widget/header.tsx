import { Settings, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { APP_NAME } from "../../../shared/constants";

export function Header(props: {
  setIsExpanded: (() => void) | (() => Promise<void>);
  onOpenSettings: () => void;
}) {
  const { setIsExpanded, onOpenSettings } = props;
  return (
    <div
      className="flex flex-shrink-0 cursor-move select-none items-center justify-between border-border border-b bg-card/50 p-4"
      data-tauri-drag-region
    >
      <div className="flex items-center gap-2" data-tauri-drag-region>
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-transparent">
          <img
            alt="Logo"
            className="pointer-events-none w-full object-cover"
            src="/icon-dark.svg"
          />
        </div>
        <div data-tauri-drag-region>
          <h3 className="font-semibold text-foreground text-sm">{APP_NAME}</h3>
          <p className="text-muted-foreground text-xs">System Manager</p>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <Button
          className="h-8 w-8 p-0"
          onClick={onOpenSettings}
          size="sm"
          variant="ghost"
        >
          <Settings className="h-4 w-4" />
        </Button>
        <Button
          className="h-8 w-8 p-0"
          onClick={() => setIsExpanded()}
          size="sm"
          variant="ghost"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
