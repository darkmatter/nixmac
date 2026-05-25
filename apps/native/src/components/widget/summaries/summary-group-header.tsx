import type { ChangeSummary } from "@/ipc/types";

type SummaryGroupHeaderProps = Pick<ChangeSummary, "title" | "description">;

export function SummaryGroupHeader({ title, description }: SummaryGroupHeaderProps) {
  const heading = description ? `${title} — ${description}` : title;
  return (
    <p className="mb-[5px] text-[11px] font-medium text-neutral-400">{heading}</p>
  );
}
