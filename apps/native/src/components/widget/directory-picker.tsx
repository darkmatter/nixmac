"use client";

import { Button } from "@/components/ui/button";
import { useDarwinConfig } from "@/hooks/use-darwin-config";
import { useWidgetStore } from "@/stores/widget-store";
import { FolderOpen } from "lucide-react";

type DirectoryPickerProps = {
  label: string;
  subLabel?: string;
};

export function DirectoryPicker({ label, subLabel }: DirectoryPickerProps) {
  const configDir = useWidgetStore((state) => state.configDir);
  const { pickDir } = useDarwinConfig();

  return (
    <div className="space-y-2">
      <label className="font-medium text-sm">
        {label}
        {subLabel && (
          <span className="text-muted-foreground ml-2 font-light text-xs">
            ({subLabel})
          </span>
        )}
      </label>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <div className="flex-1 truncate rounded-md border border-border bg-muted/50 px-3 py-2 font-mono text-xs">
            {configDir || "Not selected"}
          </div>
          <Button onClick={pickDir} size="sm" variant="secondary">
            <FolderOpen className="mr-1 h-3 w-3" />
            Browse
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">
          Press ⌘+⇧+. when browsing to show hidden folders like{" "}
          <code className="rounded bg-muted px-1">.darwin</code>
        </p>
      </div>
    </div>
  );
}