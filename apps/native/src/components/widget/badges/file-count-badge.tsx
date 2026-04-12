import { File } from "lucide-react";

export function FileCountBadge({ fileCount }: { fileCount: number }) {
  return (
    <span className="inline-flex items-center gap-[3px] text-[10px] text-neutral-500">
      <File className="h-[10px] w-[10px] mb-[1px]" />
      {fileCount} {fileCount === 1 ? "file" : "files"}
    </span>
  );
}
