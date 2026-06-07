import { MarkdownDescription } from "@/components/widget/summaries/markdown-description";
import { commitMessageBody } from "@/components/widget/summaries/markdown-utils";
import type { ChangeSummary } from "@/ipc/types";

type SummaryGroupHeaderProps = Pick<ChangeSummary, "title" | "description">;

export function SummaryGroupHeader({ title, description }: SummaryGroupHeaderProps) {
  const body = commitMessageBody(description ?? "");

  return (
    <div className="mb-[5px]">
      <p className="text-[11px] font-medium text-neutral-400">{title}</p>
      {body && (
        <MarkdownDescription
          className="text-[11px] text-neutral-500"
          modalTitle={title}
          text={body}
        />
      )}
    </div>
  );
}
