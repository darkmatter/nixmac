"use client";

import { FileBadge } from "@/components/ui/file-badge";
import { getShortFilename } from "@/components/widget/utils";
import { FolderOpen } from "lucide-react";

export function ConfigDirBadge({ configDir }: { configDir: string }) {
  const dirName = getShortFilename(configDir) || "config";
  return <FileBadge icon={FolderOpen}>{dirName}</FileBadge>;
}
