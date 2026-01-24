import { Button } from "@/components/ui/button";
import { Settings } from "lucide-react";
import { APP_NAME } from "../../../shared/constants";

export function Header(props: { onOpenSettings: () => void }) {
  const { onOpenSettings } = props;
  return (
    <div
      className="relative flex flex-shrink-0 cursor-move select-none items-center justify-center border-border border-b bg-card/50 px-3 pt-3 pb-3"
      data-tauri-drag-region
    >
      <div className="absolute top-2 left-0 h-4 w-16 z-[9999] cursor-default" />

      <h3
        className="font-medium text-muted-foreground text-xs"
        data-tauri-drag-region
      >
        {APP_NAME}
      </h3>
      <div className="absolute right-3 flex items-center gap-1">
        <Button
          className="h-8 w-8 p-0"
          onClick={onOpenSettings}
          size="sm"
          variant="ghost"
        >
          <Settings className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
