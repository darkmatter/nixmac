"use client";

import { getShortFilename } from "@/components/widget/utils";
import { FolderOpen } from "lucide-react";

interface ConfigDirBadgeProps {
  configDir: string;
}

export function ConfigDirBadge({ configDir }: ConfigDirBadgeProps) {
  const dirName = getShortFilename(configDir) || "config";

  return (
    <code className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono">
      <FolderOpen className="h-3 w-3" />
      {dirName}
    </code>
  );
}
