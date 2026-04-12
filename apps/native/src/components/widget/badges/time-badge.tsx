import { formatRelativeTime } from "@/components/widget/utils";

export function TimeBadge({ createdAt }: { createdAt: number }) {
  return (
    <span className="text-[10px] text-neutral-500">
      {formatRelativeTime(createdAt)}
    </span>
  );
}
